package objectstore

import (
	"context"
	"fmt"
	"strings"

	appconfig "app/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Client struct {
	cfg     appconfig.StorageConfig
	presign *s3.PresignClient
	s3      *s3.Client
}

func New(ctx context.Context, cfg appconfig.StorageConfig) (*Client, error) {
	if cfg.Provider != "s3" {
		return nil, fmt.Errorf("unsupported storage provider %q", cfg.Provider)
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKeyID,
			cfg.SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("load s3 config: %w", err)
	}
	if strings.TrimSpace(cfg.Endpoint) != "" {
		awsCfg.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		awsCfg.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	}

	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		if strings.TrimSpace(cfg.Endpoint) != "" {
			options.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		options.UsePathStyle = cfg.ForcePathStyle
	})
	presignClient := s3.NewPresignClient(s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		if strings.TrimSpace(cfg.AssetsHostname) != "" {
			options.BaseEndpoint = aws.String("https://" + strings.TrimSpace(cfg.AssetsHostname))
		}
		options.UsePathStyle = cfg.ForcePathStyle
	}))

	return &Client{
		cfg:     cfg,
		presign: presignClient,
		s3:      client,
	}, nil
}
