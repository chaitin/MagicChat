package gateway

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"push-gateway/internal/model"
	"push-gateway/internal/provider"
	"push-gateway/internal/secure"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	EventMessageCreated = "message.created"

	maxProviderTokenBytes = 4096
	maxAppVersionBytes    = 64
	maxIdempotencyBytes   = 200
	maxRouteTokenBytes    = 512
	maxCollapseKeyBytes   = 64
)

type Options struct {
	DB                                *gorm.DB
	Providers                         []provider.Provider
	Now                               func() time.Time
	GrantTTL                          time.Duration
	NotificationTTL                   time.Duration
	MaxNotificationTTL                time.Duration
	JobRetention                      time.Duration
	InstallationRetention             time.Duration
	MaxJobsPerGrantMinute             int64
	MaxRegistrationsPerIPMinute       int64
	MaxRegistrationsGlobalMinute      int64
	MaxGrantRotationsPerInstallMinute int64
	MaxNotificationsGlobalMinute      int64
}

type Service struct {
	db                                *gorm.DB
	providers                         map[string]provider.Provider
	now                               func() time.Time
	grantTTL                          time.Duration
	notificationTTL                   time.Duration
	maxNotificationTTL                time.Duration
	jobRetention                      time.Duration
	installationRetention             time.Duration
	maxJobsPerGrantMinute             int64
	maxRegistrationsPerIPMinute       int64
	maxRegistrationsGlobalMinute      int64
	maxGrantRotationsPerInstallMinute int64
	maxNotificationsGlobalMinute      int64
	quotaRejected                     atomic.Uint64
}

func New(options Options) (*Service, error) {
	if options.DB == nil {
		return nil, fmt.Errorf("database is required")
	}
	providers := make(map[string]provider.Provider, len(options.Providers))
	for _, value := range options.Providers {
		if value == nil || strings.TrimSpace(value.Name()) == "" {
			return nil, fmt.Errorf("provider name is required")
		}
		if _, exists := providers[value.Name()]; exists {
			return nil, fmt.Errorf("duplicate provider %q", value.Name())
		}
		providers[value.Name()] = value
	}
	if len(providers) == 0 {
		return nil, fmt.Errorf("at least one provider is required")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	grantTTL := options.GrantTTL
	if grantTTL <= 0 {
		grantTTL = 30 * 24 * time.Hour
	}
	notificationTTL := options.NotificationTTL
	if notificationTTL <= 0 {
		notificationTTL = 5 * time.Minute
	}
	maxNotificationTTL := options.MaxNotificationTTL
	if maxNotificationTTL <= 0 {
		maxNotificationTTL = time.Hour
	}
	jobRetention := options.JobRetention
	if jobRetention <= 0 {
		jobRetention = 7 * 24 * time.Hour
	}
	installationRetention := options.InstallationRetention
	if installationRetention <= 0 {
		installationRetention = 90 * 24 * time.Hour
	}
	if installationRetention < jobRetention {
		return nil, fmt.Errorf("installation retention must not be shorter than job retention")
	}
	maxJobs := options.MaxJobsPerGrantMinute
	if maxJobs <= 0 {
		maxJobs = 120
	}
	registrationsPerIP := options.MaxRegistrationsPerIPMinute
	if registrationsPerIP <= 0 {
		registrationsPerIP = 20
	}
	registrationsGlobal := options.MaxRegistrationsGlobalMinute
	if registrationsGlobal <= 0 {
		registrationsGlobal = 1000
	}
	grantRotations := options.MaxGrantRotationsPerInstallMinute
	if grantRotations <= 0 {
		grantRotations = 10
	}
	notificationsGlobal := options.MaxNotificationsGlobalMinute
	if notificationsGlobal <= 0 {
		notificationsGlobal = 10000
	}
	return &Service{
		db: options.DB, providers: providers, now: now,
		grantTTL: grantTTL, notificationTTL: notificationTTL,
		maxNotificationTTL: maxNotificationTTL, jobRetention: jobRetention,
		installationRetention:             installationRetention,
		maxJobsPerGrantMinute:             maxJobs,
		maxRegistrationsPerIPMinute:       registrationsPerIP,
		maxRegistrationsGlobalMinute:      registrationsGlobal,
		maxGrantRotationsPerInstallMinute: grantRotations,
		maxNotificationsGlobalMinute:      notificationsGlobal,
	}, nil
}

type RegisterInstallationInput struct {
	ClientKey     string
	Provider      string
	ProviderToken string
	Platform      string
	Environment   string
	AppVersion    string
}

type InstallationCredential struct {
	InstallationID  string    `json:"installation_id"`
	ManagementToken string    `json:"management_token"`
	ExpiresAt       time.Time `json:"-"`
}

func (s *Service) RegisterInstallation(ctx context.Context, input RegisterInstallationInput) (InstallationCredential, error) {
	input, err := s.validateInstallationInput(input)
	if err != nil {
		return InstallationCredential{}, err
	}
	managementToken, err := secure.GenerateToken()
	if err != nil {
		return InstallationCredential{}, err
	}
	lockKey := providerTokenLockKey(input.Provider, input.Environment, input.ProviderToken)
	now := s.now().UTC()
	var installation model.Installation

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.enforceRateLimit(tx, "installation_global", "global", s.maxRegistrationsGlobalMinute, now); err != nil {
			return err
		}
		if err := s.enforceRateLimit(tx, "installation_client", input.ClientKey, s.maxRegistrationsPerIPMinute, now); err != nil {
			return err
		}
		if err := lockProviderToken(tx, lockKey); err != nil {
			return err
		}
		queryErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("provider = ? AND environment = ? AND provider_token = ?", input.Provider, input.Environment, input.ProviderToken).
			First(&installation).Error
		switch {
		case queryErr == nil:
			if err := revokeActiveGrants(tx, installation.ID, now); err != nil {
				return err
			}
		case errors.Is(queryErr, gorm.ErrRecordNotFound):
			installation.ID = uuid.NewString()
			installation.CreatedAt = now
		default:
			return queryErr
		}

		installation.Provider = input.Provider
		installation.ProviderToken = input.ProviderToken
		installation.Platform = input.Platform
		installation.Environment = input.Environment
		installation.AppVersion = input.AppVersion
		installation.ManagementTokenHash = secure.HashToken(managementToken)
		installation.Status = model.InstallationStatusActive
		installation.LastSeenAt = now
		installation.UpdatedAt = now
		return tx.Save(&installation).Error
	})
	if err != nil {
		return InstallationCredential{}, fmt.Errorf("register installation: %w", err)
	}
	return InstallationCredential{InstallationID: installation.ID, ManagementToken: managementToken}, nil
}

func (s *Service) UpdateProviderToken(ctx context.Context, installationID, managementToken, providerToken, appVersion string) error {
	var err error
	installationID, err = normalizeID(installationID)
	if err != nil {
		return err
	}
	providerToken = strings.TrimSpace(providerToken)
	appVersion = strings.TrimSpace(appVersion)
	if len(providerToken) < 8 || len(providerToken) > maxProviderTokenBytes || len(appVersion) > maxAppVersionBytes {
		return newFailure("invalid_request", "设备 Token 或应用版本格式错误")
	}
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		installation, err := loadInstallationForManagement(tx, installationID, managementToken)
		if err != nil {
			return err
		}
		if installation.Provider == "apns" {
			providerToken = strings.ToLower(providerToken)
		}
		pushProvider, ok := s.providers[installation.Provider]
		if !ok {
			return newFailure("unsupported_provider", "设备推送通道当前不可用")
		}
		if err := pushProvider.ValidateRegistration(provider.Registration{
			Token: providerToken, Platform: installation.Platform, Environment: installation.Environment,
		}); err != nil {
			return newFailure("invalid_request", "设备 Token 格式错误")
		}
		lockKey := providerTokenLockKey(installation.Provider, installation.Environment, providerToken)
		if err := lockProviderToken(tx, lockKey); err != nil {
			return err
		}
		var duplicate model.Installation
		duplicateErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("provider = ? AND environment = ? AND provider_token = ? AND id <> ?", installation.Provider, installation.Environment, providerToken, installation.ID).
			First(&duplicate).Error
		if duplicateErr == nil {
			if err := tx.Delete(&duplicate).Error; err != nil {
				return err
			}
		} else if !errors.Is(duplicateErr, gorm.ErrRecordNotFound) {
			return duplicateErr
		}
		return tx.Model(&model.Installation{}).Where("id = ?", installation.ID).Updates(map[string]any{
			"provider_token": providerToken,
			"app_version":    appVersion,
			"status":         model.InstallationStatusActive,
			"last_seen_at":   now,
			"updated_at":     now,
		}).Error
	})
}

type GrantCredential struct {
	GrantID   string    `json:"grant_id"`
	SendToken string    `json:"send_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Service) CreateActiveGrant(ctx context.Context, installationID, managementToken string) (GrantCredential, error) {
	installationID, err := normalizeID(installationID)
	if err != nil {
		return GrantCredential{}, err
	}
	sendToken, err := secure.GenerateToken()
	if err != nil {
		return GrantCredential{}, err
	}
	now := s.now().UTC()
	grant := model.Grant{
		ID: uuid.NewString(), InstallationID: strings.TrimSpace(installationID),
		SendTokenHash: secure.HashToken(sendToken), Status: model.GrantStatusActive,
		ExpiresAt: now.Add(s.grantTTL), CreatedAt: now, UpdatedAt: now,
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		installation, err := loadInstallationForManagement(tx, installationID, managementToken)
		if err != nil {
			return err
		}
		if installation.Status != model.InstallationStatusActive {
			return newFailure("installation_disabled", "设备推送已禁用")
		}
		if err := s.enforceRateLimit(tx, "grant_rotation", installation.ID, s.maxGrantRotationsPerInstallMinute, now); err != nil {
			return err
		}
		if err := revokeActiveGrants(tx, installation.ID, now); err != nil {
			return err
		}
		return tx.Create(&grant).Error
	})
	if err != nil {
		return GrantCredential{}, fmt.Errorf("create active grant: %w", err)
	}
	return GrantCredential{GrantID: grant.ID, SendToken: sendToken, ExpiresAt: grant.ExpiresAt}, nil
}

func (s *Service) RenewGrant(ctx context.Context, grantID, managementToken string) (time.Time, error) {
	grantID, err := normalizeID(grantID)
	if err != nil {
		return time.Time{}, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(s.grantTTL)
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		grant, err := loadGrantForManagement(tx, grantID, managementToken)
		if err != nil {
			return err
		}
		if grant.Status != model.GrantStatusActive || grant.Installation.Status != model.InstallationStatusActive {
			return newFailure("grant_revoked", "推送授权已失效")
		}
		if !grant.ExpiresAt.After(now) {
			return newFailure("grant_expired", "推送授权已过期")
		}
		return tx.Model(&model.Grant{}).Where("id = ?", grant.ID).Updates(map[string]any{
			"expires_at": expiresAt, "updated_at": now,
		}).Error
	})
	return expiresAt, err
}

func (s *Service) RevokeGrant(ctx context.Context, grantID, managementToken string) error {
	grantID, err := normalizeID(grantID)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		grant, err := loadGrantForManagement(tx, grantID, managementToken)
		if err != nil {
			return err
		}
		if grant.Status != model.GrantStatusActive {
			return nil
		}
		return tx.Model(&model.Grant{}).Where("id = ?", grant.ID).Updates(map[string]any{
			"status": model.GrantStatusRevoked, "revoked_at": now, "updated_at": now,
		}).Error
	})
}

type NotificationInput struct {
	Event          string
	RouteToken     string
	CollapseKey    string
	TTLSeconds     int
	IdempotencyKey string
}

type JobResult struct {
	JobID     string `json:"job_id"`
	Accepted  bool   `json:"accepted"`
	Duplicate bool   `json:"duplicate,omitempty"`
}

func (s *Service) EnqueueNotification(ctx context.Context, grantID, sendToken, serverKey string, input NotificationInput) (JobResult, error) {
	grantID, err := normalizeID(grantID)
	if err != nil {
		return JobResult{}, err
	}
	input.Event = strings.TrimSpace(input.Event)
	input.RouteToken = strings.TrimSpace(input.RouteToken)
	input.CollapseKey = strings.TrimSpace(input.CollapseKey)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.Event != EventMessageCreated {
		return JobResult{}, newFailure("unsupported_event", "不支持的推送事件")
	}
	if len(input.RouteToken) < 8 || len(input.RouteToken) > maxRouteTokenBytes ||
		len(input.CollapseKey) > maxCollapseKeyBytes || len(input.IdempotencyKey) < 8 ||
		len(input.IdempotencyKey) > maxIdempotencyBytes {
		return JobResult{}, newFailure("invalid_request", "推送请求格式错误")
	}
	now := s.now().UTC()
	ttl := s.notificationTTL
	if input.TTLSeconds > 0 {
		if input.TTLSeconds > int(s.maxNotificationTTL/time.Second) {
			return JobResult{}, newFailure("invalid_request", "推送有效期格式错误")
		}
		ttl = time.Duration(input.TTLSeconds) * time.Second
	}
	if ttl <= 0 || ttl > s.maxNotificationTTL {
		return JobResult{}, newFailure("invalid_request", "推送有效期格式错误")
	}

	var result JobResult
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		server, err := authenticateServer(tx, serverKey)
		if err != nil {
			return err
		}
		var grant model.Grant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Installation").First(&grant, "id = ?", strings.TrimSpace(grantID)).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return newFailure("grant_not_found", "推送授权不存在")
			}
			return err
		}
		if !secure.MatchesToken(grant.SendTokenHash, strings.TrimSpace(sendToken)) {
			return newFailure("unauthorized", "推送授权认证失败")
		}
		if grant.Status != model.GrantStatusActive || grant.Installation.Status != model.InstallationStatusActive {
			return newFailure("grant_revoked", "推送授权已失效")
		}
		if !grant.ExpiresAt.After(now) {
			return newFailure("grant_expired", "推送授权已过期")
		}

		var existing model.Job
		existingErr := tx.Where("grant_id = ? AND idempotency_key = ?", grant.ID, input.IdempotencyKey).First(&existing).Error
		if existingErr == nil {
			if existing.ServerID == nil || *existing.ServerID != server.ID {
				return newFailure("idempotency_conflict", "幂等键已被其他服务器使用")
			}
			result = JobResult{JobID: existing.ID, Accepted: true, Duplicate: true}
			return nil
		}
		if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		if server.Status != model.ServerStatusActive {
			return newFailure("server_disabled", "服务器已禁用")
		}
		if err := s.enforceRateLimit(tx, "notification_global", "global", s.maxNotificationsGlobalMinute, now); err != nil {
			return err
		}
		var recentCount int64
		if err := tx.Model(&model.Job{}).Where("grant_id = ? AND created_at >= ?", grant.ID, now.Add(-time.Minute)).Count(&recentCount).Error; err != nil {
			return err
		}
		if recentCount >= s.maxJobsPerGrantMinute {
			return newFailure("rate_limited", "推送请求过于频繁")
		}

		quotaDate, err := chargeServerQuota(tx, server, now)
		if err != nil {
			return err
		}
		job := model.Job{
			ID: uuid.NewString(), GrantID: grant.ID, IdempotencyKey: input.IdempotencyKey,
			EventType: input.Event, RouteToken: input.RouteToken, CollapseKey: input.CollapseKey,
			Status: model.JobStatusQueued, NextAttemptAt: now, ExpiresAt: now.Add(ttl),
			CreatedAt: now, UpdatedAt: now, ServerID: &server.ID, QuotaDate: &quotaDate,
		}
		// The grant row is locked above, so requests for the same grant are
		// serialized before this insert and the idempotency lookup is race-free.
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Grant{}).Where("id = ?", grant.ID).Updates(map[string]any{
			"last_used_at": now, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		result = JobResult{JobID: job.ID, Accepted: true}
		return nil
	})
	if err != nil {
		if failure, ok := FailureOf(err); ok && failure.Code == "daily_quota_exceeded" {
			s.quotaRejected.Add(1)
		}
		return JobResult{}, err
	}
	return result, nil
}

func (s *Service) QuotaRejectedTotal() uint64 {
	return s.quotaRejected.Load()
}

func (s *Service) validateInstallationInput(input RegisterInstallationInput) (RegisterInstallationInput, error) {
	input.ClientKey = strings.TrimSpace(input.ClientKey)
	input.Provider = strings.TrimSpace(input.Provider)
	input.ProviderToken = strings.TrimSpace(input.ProviderToken)
	input.Platform = strings.TrimSpace(input.Platform)
	input.Environment = strings.TrimSpace(input.Environment)
	input.AppVersion = strings.TrimSpace(input.AppVersion)
	if input.Provider == "apns" {
		input.ProviderToken = strings.ToLower(input.ProviderToken)
	}
	if input.Environment == "" {
		input.Environment = "production"
	}
	if _, ok := s.providers[input.Provider]; !ok {
		return input, newFailure("unsupported_provider", "不支持的推送通道")
	}
	if input.Platform != "android" && input.Platform != "ios" {
		return input, newFailure("invalid_request", "设备平台格式错误")
	}
	if input.Provider == "apns" && input.Platform != "ios" ||
		(input.Provider == "jpush" || input.Provider == "getui") && input.Platform != "android" {
		return input, newFailure("invalid_request", "推送通道与设备平台不匹配")
	}
	if input.Environment != "development" && input.Environment != "production" {
		return input, newFailure("invalid_request", "推送环境格式错误")
	}
	if len(input.ProviderToken) < 8 || len(input.ProviderToken) > maxProviderTokenBytes || len(input.AppVersion) > maxAppVersionBytes {
		return input, newFailure("invalid_request", "设备 Token 或应用版本格式错误")
	}
	if err := s.providers[input.Provider].ValidateRegistration(provider.Registration{
		Token: input.ProviderToken, Platform: input.Platform, Environment: input.Environment,
	}); err != nil {
		return input, newFailure("invalid_request", "设备 Token 格式错误")
	}
	return input, nil
}

func loadInstallationForManagement(tx *gorm.DB, installationID, managementToken string) (model.Installation, error) {
	var installation model.Installation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&installation, "id = ?", strings.TrimSpace(installationID)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Installation{}, newFailure("installation_not_found", "设备安装实例不存在")
		}
		return model.Installation{}, err
	}
	if !secure.MatchesToken(installation.ManagementTokenHash, strings.TrimSpace(managementToken)) {
		return model.Installation{}, newFailure("unauthorized", "设备管理认证失败")
	}
	return installation, nil
}

func loadGrantForManagement(tx *gorm.DB, grantID, managementToken string) (model.Grant, error) {
	var grant model.Grant
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Installation").First(&grant, "id = ?", strings.TrimSpace(grantID)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.Grant{}, newFailure("grant_not_found", "推送授权不存在")
		}
		return model.Grant{}, err
	}
	if !secure.MatchesToken(grant.Installation.ManagementTokenHash, strings.TrimSpace(managementToken)) {
		return model.Grant{}, newFailure("unauthorized", "设备管理认证失败")
	}
	return grant, nil
}

func revokeActiveGrants(tx *gorm.DB, installationID string, now time.Time) error {
	return tx.Model(&model.Grant{}).
		Where("installation_id = ? AND status = ?", installationID, model.GrantStatusActive).
		Updates(map[string]any{"status": model.GrantStatusRevoked, "revoked_at": now, "updated_at": now}).Error
}

func (s *Service) enforceRateLimit(tx *gorm.DB, scope, key string, limit int64, now time.Time) error {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "unknown"
	}
	var count int64
	err := tx.Raw(`
		INSERT INTO push_rate_limits (scope, key_hash, window_start, count, updated_at)
		VALUES (?, ?, ?, 1, ?)
		ON CONFLICT (scope, key_hash, window_start)
		DO UPDATE SET count = push_rate_limits.count + 1, updated_at = EXCLUDED.updated_at
		RETURNING count
	`, scope, secure.HashToken(scope+"\x00"+key), now.Truncate(time.Minute), now).Scan(&count).Error
	if err != nil {
		return err
	}
	if count > limit {
		return newFailure("rate_limited", "请求过于频繁")
	}
	return nil
}

func normalizeID(value string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", newFailure("invalid_request", "资源 ID 格式错误")
	}
	return parsed.String(), nil
}

func providerTokenLockKey(providerName, environment, token string) []byte {
	return secure.HashToken(providerName + "\x00" + environment + "\x00" + token)
}

func lockProviderToken(tx *gorm.DB, tokenHash []byte) error {
	if tx.Dialector.Name() != "postgres" {
		return nil
	}
	// Serializing by a non-secret prefix of the hash closes the absent-row race
	// between two first registrations of the same provider token.
	key := int64(binary.BigEndian.Uint64(tokenHash[:8]))
	return tx.Exec("SELECT pg_advisory_xact_lock(?)", key).Error
}
