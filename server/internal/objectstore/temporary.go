package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const TemporaryReadURLTTL = 24 * time.Hour

func (c *Client) PutTemporaryObject(ctx context.Context, key string, body io.Reader, sizeBytes int64, contentType string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return errors.New("temporary object key is required")
	}
	if sizeBytes < 0 {
		return errors.New("temporary object size must be non-negative")
	}

	input := &s3.PutObjectInput{
		Bucket:        aws.String(c.cfg.Buckets.Temporary),
		Key:           aws.String(key),
		Body:          body,
		ContentLength: aws.Int64(sizeBytes),
	}
	if contentType = strings.TrimSpace(contentType); contentType != "" {
		input.ContentType = aws.String(contentType)
	}

	_, err := c.s3.PutObject(ctx, input)
	return err
}

func (c *Client) PresignTemporaryReadURL(ctx context.Context, key string) (string, time.Time, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", time.Time{}, errors.New("temporary object key is required")
	}
	if strings.TrimSpace(c.cfg.AssetsHostname) == "" {
		return "", time.Time{}, errors.New("assets hostname is required")
	}

	expiresAt := time.Now().UTC().Add(TemporaryReadURLTTL)
	request, err := c.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.cfg.Buckets.Temporary),
		Key:    aws.String(key),
	}, func(options *s3.PresignOptions) {
		options.Expires = TemporaryReadURLTTL
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("presign temporary object: %w", err)
	}

	return request.URL, expiresAt, nil
}
