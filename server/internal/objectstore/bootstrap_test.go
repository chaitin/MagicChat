package objectstore

import (
	"testing"

	fileapp "app/internal/application/file"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func TestTemporaryLifecycleRulesUseStandardAndLargeRetention(t *testing.T) {
	rules := temporaryLifecycleRules(fileapp.DefaultTemporaryExpireDays, 7)
	if len(rules) != 2 {
		t.Fatalf("lifecycle rule count = %d, want 2", len(rules))
	}
	if !temporaryLifecycleRuleMatches(
		rules[0],
		fileapp.TemporaryObjectPrefix,
		fileapp.DefaultTemporaryExpireDays,
		7,
	) {
		t.Fatalf("standard lifecycle rule = %#v", rules[0])
	}
	if !temporaryLifecycleRuleMatches(
		rules[1],
		fileapp.TemporaryLargeObjectPrefix,
		fileapp.LargeTemporaryExpireDays,
		0,
	) {
		t.Fatalf("large lifecycle rule = %#v", rules[1])
	}
	if !temporaryLifecycleConfigured(rules, fileapp.DefaultTemporaryExpireDays, 7) {
		t.Fatal("generated lifecycle rules are not recognized as configured")
	}
}

func TestMergeTemporaryLifecycleRulesPreservesUnmanagedRulesAndReplacesManagedRules(t *testing.T) {
	unmanaged := types.LifecycleRule{
		Expiration: &types.LifecycleExpiration{Days: aws.Int32(365)},
		Filter:     &types.LifecycleRuleFilter{Prefix: aws.String("unmanaged/")},
		ID:         aws.String("retain-unmanaged-rule"),
		Status:     types.ExpirationStatusEnabled,
	}
	existing := []types.LifecycleRule{
		unmanaged,
		{
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(1)},
			Filter:     &types.LifecycleRuleFilter{},
			ID:         aws.String(temporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
		{
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(90)},
			Filter:     &types.LifecycleRuleFilter{Prefix: aws.String("old-large/")},
			ID:         aws.String(largeTemporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
	}

	merged := mergeTemporaryLifecycleRules(existing, fileapp.DefaultTemporaryExpireDays, 7)
	if len(merged) != 3 {
		t.Fatalf("merged lifecycle rule count = %d, want 3", len(merged))
	}
	if aws.ToString(merged[0].ID) != aws.ToString(unmanaged.ID) {
		t.Fatalf("first merged lifecycle rule = %q, want unmanaged rule", aws.ToString(merged[0].ID))
	}
	if !temporaryLifecycleConfigured(merged, fileapp.DefaultTemporaryExpireDays, 7) {
		t.Fatalf("merged lifecycle rules are not configured: %#v", merged)
	}
}

func TestTemporaryLifecycleConfiguredRejectsIncompleteOrIncorrectRules(t *testing.T) {
	valid := temporaryLifecycleRules(fileapp.DefaultTemporaryExpireDays, 7)
	tests := []struct {
		name  string
		rules func() []types.LifecycleRule
	}{
		{
			name: "missing large rule",
			rules: func() []types.LifecycleRule {
				return append([]types.LifecycleRule(nil), valid[0])
			},
		},
		{
			name: "wrong standard prefix",
			rules: func() []types.LifecycleRule {
				result := append([]types.LifecycleRule(nil), valid...)
				result[0].Filter = &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryStandardObjectPrefix)}
				return result
			},
		},
		{
			name: "wrong large expiration",
			rules: func() []types.LifecycleRule {
				result := append([]types.LifecycleRule(nil), valid...)
				result[1].Expiration = &types.LifecycleExpiration{Days: aws.Int32(31)}
				return result
			},
		},
		{
			name: "duplicate managed rule",
			rules: func() []types.LifecycleRule {
				return append(append([]types.LifecycleRule(nil), valid...), valid[0])
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if temporaryLifecycleConfigured(test.rules(), fileapp.DefaultTemporaryExpireDays, 7) {
				t.Fatal("incorrect lifecycle rules were recognized as configured")
			}
		})
	}
}
