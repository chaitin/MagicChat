package mobilepush

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	pushJobTTL        = 5 * time.Minute
	pushDeliveryDelay = 5 * time.Second
	pushPresenceTTL   = 45 * time.Second
	pushRouteTTL      = 7 * 24 * time.Hour
	maxSendToken      = 512
	minSendToken      = 32
	maxGrantLease     = 365 * 24 * time.Hour
	maxGrantsPerUser  = 10
)

type Dependencies struct {
	DB      *gorm.DB
	Cipher  *TokenCipher
	Gateway GatewayClient
	Enabled bool
	Now     func() time.Time
}

type Service struct {
	db      *gorm.DB
	cipher  *TokenCipher
	gateway GatewayClient
	grants  *grantService
	routes  *routeService
	enabled bool
	now     func() time.Time
}

func NewService(deps Dependencies) (*Service, error) {
	if deps.DB == nil {
		return nil, errors.New("mobile push database is required")
	}
	if deps.Enabled && (deps.Cipher == nil || deps.Gateway == nil) {
		return nil, errors.New("mobile push cipher and gateway client are required when enabled")
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	service := &Service{
		db: deps.DB, cipher: deps.Cipher, gateway: deps.Gateway,
		enabled: deps.Enabled, now: now,
	}
	service.grants = &grantService{
		db: deps.DB, cipher: deps.Cipher, enabled: deps.Enabled, now: now,
	}
	service.routes = &routeService{db: deps.DB, now: now}
	if deps.Enabled {
		if err := service.registerMessageEventCallback(); err != nil {
			return nil, fmt.Errorf("register mobile push message event callback: %w", err)
		}
	}
	return service, nil
}

func (s *Service) Enabled() bool { return s.enabled }

func (s *Service) RegisterGrant(ctx context.Context, cmd RegisterGrantCommand) (Grant, error) {
	return s.grants.Register(ctx, cmd)
}

func (s *Service) RevokeGrant(ctx context.Context, userID, installationID, gatewayGrantID string) error {
	return s.grants.Revoke(ctx, userID, installationID, gatewayGrantID)
}

func (s *Service) ResolveRoute(ctx context.Context, userID, routeToken string) (Route, error) {
	return s.routes.Resolve(ctx, userID, routeToken)
}

func lockRegistrationKey(tx *gorm.DB, value string) error {
	if tx.Dialector.Name() != "postgres" {
		return nil
	}
	digest := sha256.Sum256([]byte(value))
	key := int64(binary.BigEndian.Uint64(digest[:8]))
	return tx.Exec("SELECT pg_advisory_xact_lock(?)", key).Error
}

func normalizeUUID(value string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", failure("invalid_request", "资源 ID 格式错误")
	}
	return parsed.String(), nil
}
