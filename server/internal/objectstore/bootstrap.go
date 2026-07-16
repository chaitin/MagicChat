package objectstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	fileapp "app/internal/application/file"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

const bootstrapRetryInterval = 2 * time.Second

const (
	temporaryLifecycleRuleID      = "expire-temporary-assets"
	largeTemporaryLifecycleRuleID = "expire-large-temporary-assets"
)

type publicReadPolicy struct {
	Version   string                `json:"Version"`
	Statement []publicReadStatement `json:"Statement"`
}

type publicReadStatement struct {
	Effect    string `json:"Effect"`
	Principal string `json:"Principal"`
	Action    string `json:"Action"`
	Resource  string `json:"Resource"`
}

func (c *Client) Bootstrap(ctx context.Context) error {
	for {
		err := c.bootstrapOnce(ctx)
		if err == nil {
			return nil
		}
		if !isRetryableBootstrapError(err) {
			return err
		}

		timer := time.NewTimer(bootstrapRetryInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return fmt.Errorf("bootstrap storage: %w", err)
		case <-timer.C:
		}
	}
}

func (c *Client) bootstrapOnce(ctx context.Context) error {
	buckets := []string{
		c.cfg.Buckets.Public,
		c.cfg.Buckets.Private,
		c.cfg.Buckets.Temporary,
	}

	for _, bucket := range buckets {
		if err := c.ensureBucket(ctx, bucket); err != nil {
			return fmt.Errorf("ensure bucket %q: %w", bucket, err)
		}
		if err := c.ensureBucketCORS(ctx, bucket); err != nil {
			return fmt.Errorf("ensure bucket cors %q: %w", bucket, err)
		}
	}

	if err := c.ensurePublicReadPolicy(ctx, c.cfg.Buckets.Public); err != nil {
		return fmt.Errorf("ensure public bucket policy %q: %w", c.cfg.Buckets.Public, err)
	}
	if err := c.ensureTemporaryLifecycle(ctx, c.cfg.Buckets.Temporary); err != nil {
		return fmt.Errorf("ensure temporary bucket lifecycle %q: %w", c.cfg.Buckets.Temporary, err)
	}

	return nil
}

func (c *Client) ensureBucket(ctx context.Context, bucket string) error {
	_, err := c.s3.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(bucket),
	})
	if err == nil {
		return nil
	}
	if !isAPIErrorCode(err, "NotFound", "NoSuchBucket", "404") {
		return err
	}

	input := &s3.CreateBucketInput{
		Bucket: aws.String(bucket),
	}
	if c.cfg.Region != "" && c.cfg.Region != "us-east-1" {
		input.CreateBucketConfiguration = &types.CreateBucketConfiguration{
			LocationConstraint: types.BucketLocationConstraint(c.cfg.Region),
		}
	}

	_, err = c.s3.CreateBucket(ctx, input)
	if err == nil || isAPIErrorCode(err, "BucketAlreadyOwnedByYou") {
		return nil
	}

	return err
}

func (c *Client) ensurePublicReadPolicy(ctx context.Context, bucket string) error {
	_, err := c.s3.GetBucketPolicy(ctx, &s3.GetBucketPolicyInput{
		Bucket: aws.String(bucket),
	})
	if err == nil {
		return nil
	}
	if !isAPIErrorCode(err, "NoSuchBucketPolicy", "NoSuchPolicy", "NotFound", "404") {
		return err
	}

	policy, err := buildPublicReadPolicy(bucket)
	if err != nil {
		return err
	}
	_, err = c.s3.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
		Bucket: aws.String(bucket),
		Policy: aws.String(policy),
	})

	return err
}

func (c *Client) ensureBucketCORS(ctx context.Context, bucket string) error {
	_, err := c.s3.GetBucketCors(ctx, &s3.GetBucketCorsInput{
		Bucket: aws.String(bucket),
	})
	if err == nil {
		return nil
	}
	if !isAPIErrorCode(err, "NoSuchCORSConfiguration", "NoSuchCorsConfiguration", "NotFound", "404") {
		return err
	}

	maxAgeSeconds := int32(3600)
	_, err = c.s3.PutBucketCors(ctx, &s3.PutBucketCorsInput{
		Bucket: aws.String(bucket),
		CORSConfiguration: &types.CORSConfiguration{
			CORSRules: []types.CORSRule{
				{
					AllowedHeaders: []string{"*"},
					AllowedMethods: []string{"GET", "HEAD", "PUT"},
					AllowedOrigins: []string{"*"},
					ExposeHeaders:  []string{"ETag"},
					ID:             aws.String("default"),
					MaxAgeSeconds:  aws.Int32(maxAgeSeconds),
				},
			},
		},
	})
	if strings.TrimSpace(c.cfg.Endpoint) != "" && isAPIErrorCode(err, "NotImplemented") {
		return nil
	}

	return err
}

func (c *Client) ensureTemporaryLifecycle(ctx context.Context, bucket string) error {
	output, err := c.s3.GetBucketLifecycleConfiguration(ctx, &s3.GetBucketLifecycleConfigurationInput{
		Bucket: aws.String(bucket),
	})
	if err == nil && output != nil {
		if temporaryLifecycleConfigured(
			output.Rules,
			c.cfg.Lifecycle.TemporaryExpireDays,
			c.cfg.Lifecycle.AbortMultipartDays,
		) {
			return nil
		}
	}
	if err != nil && !isAPIErrorCode(err, "NoSuchLifecycleConfiguration", "NoSuchLifecycle", "NotFound", "404") {
		return err
	}
	var existing []types.LifecycleRule
	if output != nil {
		existing = output.Rules
	}
	rules := mergeTemporaryLifecycleRules(
		existing,
		c.cfg.Lifecycle.TemporaryExpireDays,
		c.cfg.Lifecycle.AbortMultipartDays,
	)

	_, err = c.s3.PutBucketLifecycleConfiguration(ctx, &s3.PutBucketLifecycleConfigurationInput{
		Bucket: aws.String(bucket),
		LifecycleConfiguration: &types.BucketLifecycleConfiguration{
			Rules: rules,
		},
	})

	return err
}

func mergeTemporaryLifecycleRules(existing []types.LifecycleRule, standardExpireDays, abortMultipartDays int32) []types.LifecycleRule {
	rules := make([]types.LifecycleRule, 0, len(existing)+2)
	for _, rule := range existing {
		id := strings.TrimSpace(aws.ToString(rule.ID))
		if id == temporaryLifecycleRuleID || id == largeTemporaryLifecycleRuleID {
			continue
		}
		rules = append(rules, rule)
	}
	return append(rules, temporaryLifecycleRules(standardExpireDays, abortMultipartDays)...)
}

func temporaryLifecycleRules(standardExpireDays, abortMultipartDays int32) []types.LifecycleRule {
	return []types.LifecycleRule{
		{
			AbortIncompleteMultipartUpload: &types.AbortIncompleteMultipartUpload{
				DaysAfterInitiation: aws.Int32(abortMultipartDays),
			},
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(standardExpireDays)},
			Filter:     &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryObjectPrefix)},
			ID:         aws.String(temporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
		{
			Expiration: &types.LifecycleExpiration{Days: aws.Int32(fileapp.LargeTemporaryExpireDays)},
			Filter:     &types.LifecycleRuleFilter{Prefix: aws.String(fileapp.TemporaryLargeObjectPrefix)},
			ID:         aws.String(largeTemporaryLifecycleRuleID),
			Status:     types.ExpirationStatusEnabled,
		},
	}
}

func temporaryLifecycleConfigured(rules []types.LifecycleRule, standardExpireDays, abortMultipartDays int32) bool {
	matched := map[string]bool{}
	for _, rule := range rules {
		id := strings.TrimSpace(aws.ToString(rule.ID))
		switch id {
		case temporaryLifecycleRuleID:
			if matched[id] || !temporaryLifecycleRuleMatches(
				rule, fileapp.TemporaryObjectPrefix, standardExpireDays, abortMultipartDays,
			) {
				return false
			}
			matched[id] = true
		case largeTemporaryLifecycleRuleID:
			if matched[id] || !temporaryLifecycleRuleMatches(
				rule, fileapp.TemporaryLargeObjectPrefix, fileapp.LargeTemporaryExpireDays, 0,
			) {
				return false
			}
			matched[id] = true
		}
	}
	return matched[temporaryLifecycleRuleID] && matched[largeTemporaryLifecycleRuleID]
}

func temporaryLifecycleRuleMatches(rule types.LifecycleRule, prefix string, expireDays, abortDays int32) bool {
	if rule.Status != types.ExpirationStatusEnabled || rule.Expiration == nil || aws.ToInt32(rule.Expiration.Days) != expireDays {
		return false
	}
	if rule.Filter == nil || aws.ToString(rule.Filter.Prefix) != prefix {
		return false
	}
	if abortDays == 0 {
		return rule.AbortIncompleteMultipartUpload == nil
	}
	return rule.AbortIncompleteMultipartUpload != nil &&
		aws.ToInt32(rule.AbortIncompleteMultipartUpload.DaysAfterInitiation) == abortDays
}

func buildPublicReadPolicy(bucket string) (string, error) {
	policy := publicReadPolicy{
		Version: "2012-10-17",
		Statement: []publicReadStatement{
			{
				Effect:    "Allow",
				Principal: "*",
				Action:    "s3:GetObject",
				Resource:  fmt.Sprintf("arn:aws:s3:::%s/*", bucket),
			},
		},
	}

	content, err := json.Marshal(policy)
	if err != nil {
		return "", err
	}

	return string(content), nil
}

func isRetryableBootstrapError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return true
	}

	switch apiErr.ErrorCode() {
	case "InternalError", "RequestTimeout", "ServiceUnavailable", "SlowDown":
		return true
	default:
		return false
	}
}

func isAPIErrorCode(err error, codes ...string) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		for _, code := range codes {
			if apiErr.ErrorCode() == code {
				return true
			}
		}
	}

	var responseErr *smithyhttp.ResponseError
	if errors.As(err, &responseErr) {
		for _, code := range codes {
			if code == fmt.Sprint(responseErr.HTTPStatusCode()) {
				return true
			}
		}
	}

	return false
}
