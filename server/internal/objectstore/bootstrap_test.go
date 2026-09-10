package objectstore

import (
	"strings"
	"testing"

	fileapp "app/internal/application/file"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestTemporaryLifecycleRulesUseIndependentRetention(t *testing.T) {
	for _, test := range []struct {
		name                    string
		standardDays, largeDays int32
	}{
		{"defaults", 180, 180},
		{"large files retained longer", 90, 365},
		{"standard files retained longer", 365, 90},
	} {
		t.Run(test.name, func(t *testing.T) {
			rules := temporaryLifecycleRules(test.standardDays, test.largeDays, 7)
			if len(rules) != 3 || !temporaryLifecycleConfigured(rules, test.standardDays, test.largeDays, 7) {
				t.Fatalf("unexpected lifecycle rules: %#v", rules)
			}
			// S3 chooses the earliest expiration among all matching prefix rules.
			for _, object := range []struct {
				key      string
				wantDays int32
			}{
				{fileapp.TemporaryStandardObjectPrefix + "file", test.standardDays},
				{fileapp.TemporaryLargeObjectPrefix + "file", test.largeDays},
				{fileapp.TemporaryObjectPrefix + "2025/01/01/legacy", max(test.standardDays, test.largeDays)},
			} {
				var earliest int32
				for _, rule := range rules {
					if rule.Status == types.ExpirationStatusEnabled && rule.Expiration != nil && strings.HasPrefix(object.key, aws.ToString(rule.Filter.Prefix)) {
						days := aws.ToInt32(rule.Expiration.Days)
						if earliest == 0 || days < earliest {
							earliest = days
						}
					}
				}
				if earliest != object.wantDays {
					t.Fatalf("expiration for %q = %d, want %d", object.key, earliest, object.wantDays)
				}
			}
		})
	}
}

func TestMergeTemporaryLifecycleRulesPreservesUnmanagedRulesAndReplacesManagedRules(t *testing.T) {
	unmanaged := types.LifecycleRule{
		Expiration: &types.LifecycleExpiration{Days: aws.Int32(365)},
		Filter:     &types.LifecycleRuleFilter{Prefix: aws.String("unmanaged/")},
		ID:         aws.String("retain-unmanaged-rule"),
		Status:     types.ExpirationStatusEnabled,
	}
	// Existing installations have two overlapping rules, including a 30-day large rule.
	existing := []types.LifecycleRule{
		unmanaged,
		{
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(180)},
			Filter:     &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryObjectPrefix)},
			ID:         aws.String(temporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
		{
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(30)},
			Filter:     &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryLargeObjectPrefix)},
			ID:         aws.String(largeTemporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
	}
	for range 2 {
		merged := mergeTemporaryLifecycleRules(existing, 90, 365, 7)
		if len(merged) != 4 {
			t.Fatalf("merged lifecycle rule count = %d, want 4", len(merged))
		}
		if aws.ToString(merged[0].ID) != aws.ToString(unmanaged.ID) || !temporaryLifecycleRuleMatches(merged[0], "unmanaged/", 365, 0) {
			t.Fatalf("unmanaged lifecycle rule changed: %#v", merged[0])
		}
		if !temporaryLifecycleConfigured(merged, 90, 365, 7) {
			t.Fatalf("merged lifecycle rules are not configured: %#v", merged)
		}
		existing = merged
	}
}

func TestTemporaryLifecycleConfiguredRejectsIncompleteOrIncorrectRules(t *testing.T) {
	valid := temporaryLifecycleRules(90, 365, 7)
	tests := []struct {
		name  string
		rules func() []types.LifecycleRule
	}{
		{
			name:  "missing standard rule",
			rules: func() []types.LifecycleRule { return append([]types.LifecycleRule(nil), valid[:2]...) },
		},
		{
			name:  "missing large rule",
			rules: func() []types.LifecycleRule { return []types.LifecycleRule{valid[0], valid[2]} },
		},
		{
			name: "overlapping root expiration too short",
			rules: func() []types.LifecycleRule {
				result := append([]types.LifecycleRule(nil), valid...)
				result[0].Expiration = &types.LifecycleExpiration{Days: aws.Int32(90)}
				return result
			},
		},
		{
			name: "wrong standard prefix",
			rules: func() []types.LifecycleRule {
				result := append([]types.LifecycleRule(nil), valid...)
				result[2].Filter = &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryObjectPrefix)}
				return result
			},
		},
		{
			name: "old thirty day large expiration",
			rules: func() []types.LifecycleRule {
				result := append([]types.LifecycleRule(nil), valid...)
				result[1].Expiration = &types.LifecycleExpiration{Days: aws.Int32(30)}
				return result
			},
		},
		{
			name:  "duplicate managed rule",
			rules: func() []types.LifecycleRule { return append(append([]types.LifecycleRule(nil), valid...), valid[2]) },
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if temporaryLifecycleConfigured(test.rules(), 90, 365, 7) {
				t.Fatal("incorrect lifecycle rules were recognized as configured")
			}
		})
	}
}
