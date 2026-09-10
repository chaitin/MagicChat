package gateway

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"push-gateway/internal/model"
	"push-gateway/internal/provider"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	staleJobLock      = time.Minute
	providerSendLimit = 30 * time.Second
	maxAttempts       = 8
)

type WorkerOptions struct {
	BatchSize    int
	PollInterval time.Duration
	Logger       *slog.Logger
}

func (s *Service) RunWorker(ctx context.Context, options WorkerOptions) {
	batchSize := options.BatchSize
	if batchSize <= 0 {
		batchSize = 50
	}
	pollInterval := options.PollInterval
	if pollInterval <= 0 {
		pollInterval = time.Second
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		processed, err := s.DispatchBatch(ctx, batchSize)
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("dispatch push jobs", "error", err)
		}
		if ctx.Err() != nil {
			return
		}
		if processed > 0 {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) DispatchBatch(ctx context.Context, limit int) (int, error) {
	jobs, err := s.claimJobs(ctx, limit)
	if err != nil {
		return 0, err
	}
	for index := range jobs {
		if err := s.dispatchJob(ctx, jobs[index]); err != nil {
			return index, err
		}
	}
	return len(jobs), nil
}

func (s *Service) claimJobs(ctx context.Context, limit int) ([]model.Job, error) {
	if limit <= 0 {
		return nil, nil
	}
	now := s.now().UTC()
	var jobs []model.Job
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("updated_at < ?", now.Add(-24*time.Hour)).Delete(&model.RateLimit{}).Error; err != nil {
			return err
		}
		if err := tx.Where("expires_at <= ?", now).Delete(&model.AdminSession{}).Error; err != nil {
			return err
		}
		if err := tx.Where("created_at < ?", now.Add(-180*24*time.Hour)).Delete(&model.AdminAuditEvent{}).Error; err != nil {
			return err
		}
		usageCutoff := now.In(beijing).AddDate(0, 0, -90).Format("2006-01-02")
		if err := tx.Where("usage_date < ?", usageCutoff).Delete(&model.ServerDailyUsage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("status IN ? AND updated_at < ?", []string{model.JobStatusAccepted, model.JobStatusFailed, model.JobStatusExpired}, now.Add(-s.jobRetention)).
			Delete(&model.Job{}).Error; err != nil {
			return err
		}
		retentionCutoff := now.Add(-s.installationRetention)
		if err := tx.Where("status IN ? AND updated_at < ?", []string{model.GrantStatusRevoked, model.GrantStatusExpired}, retentionCutoff).
			Delete(&model.Grant{}).Error; err != nil {
			return err
		}
		installationIDsWithGrants := tx.Model(&model.Grant{}).Select("installation_id")
		if err := tx.Where("updated_at < ? AND id NOT IN (?)", retentionCutoff, installationIDsWithGrants).
			Delete(&model.Installation{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Job{}).
			Where("status = ? AND locked_at < ?", model.JobStatusSending, now.Add(-staleJobLock)).
			Updates(map[string]any{
				"status": model.JobStatusRetry, "next_attempt_at": now,
				"locked_at": nil, "lock_token": "", "updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Grant{}).
			Where("status = ? AND expires_at <= ?", model.GrantStatusActive, now).
			Updates(map[string]any{"status": model.GrantStatusExpired, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Job{}).
			Where("status IN ? AND expires_at <= ?", []string{model.JobStatusQueued, model.JobStatusRetry}, now).
			Updates(map[string]any{"status": model.JobStatusExpired, "last_error_code": "ttl_expired", "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Preload("Grant.Installation").
			Where("push_jobs.status IN ? AND push_jobs.next_attempt_at <= ? AND push_jobs.expires_at > ?", []string{model.JobStatusQueued, model.JobStatusRetry}, now, now).
			Order("push_jobs.created_at ASC").Limit(limit).Find(&jobs).Error; err != nil {
			return err
		}
		for index := range jobs {
			jobs[index].Status = model.JobStatusSending
			jobs[index].Attempts++
			jobs[index].LockedAt = &now
			jobs[index].LockToken = uuid.NewString()
			jobs[index].UpdatedAt = now
			if err := tx.Model(&model.Job{}).Where("id = ?", jobs[index].ID).Updates(map[string]any{
				"status":     model.JobStatusSending,
				"attempts":   jobs[index].Attempts,
				"locked_at":  now,
				"lock_token": jobs[index].LockToken,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("claim push jobs: %w", err)
	}
	return jobs, nil
}

func (s *Service) dispatchJob(ctx context.Context, job model.Job) error {
	owned, err := s.renewJobLease(ctx, job)
	if err != nil || !owned {
		return err
	}
	now := s.now().UTC()
	if !job.ExpiresAt.After(now) {
		return s.finishJob(ctx, job, model.JobStatusExpired, "ttl_expired", "")
	}
	if job.Grant.Status != model.GrantStatusActive || !job.Grant.ExpiresAt.After(now) || job.Grant.Installation.Status != model.InstallationStatusActive {
		return s.finishJob(ctx, job, model.JobStatusFailed, "grant_inactive", "")
	}
	if job.ServerID == nil {
		return s.finishJob(ctx, job, model.JobStatusFailed, "server_inactive", "")
	}
	var server model.Server
	if err := s.db.WithContext(ctx).Select("id", "status").First(&server, "id = ?", *job.ServerID).Error; err != nil || server.Status != model.ServerStatusActive {
		return s.finishJob(ctx, job, model.JobStatusFailed, "server_inactive", "")
	}
	pushProvider, ok := s.providers[job.Grant.Installation.Provider]
	if !ok {
		return s.finishJob(ctx, job, model.JobStatusFailed, "provider_unavailable", "")
	}
	providerToken, err := s.cipher.Decrypt(job.Grant.Installation.ProviderTokenCiphertext, []byte(job.Grant.Installation.ID))
	if err != nil {
		return s.finishJob(ctx, job, model.JobStatusFailed, "provider_token_decryption_failed", "")
	}
	if s.cipher.NeedsRotation(job.Grant.Installation.ProviderTokenCiphertext) {
		rotated, err := s.cipher.Encrypt(providerToken, []byte(job.Grant.Installation.ID))
		if err != nil {
			return err
		}
		if err := s.db.WithContext(ctx).Model(&model.Installation{}).
			Where("id = ? AND provider_token_ciphertext = ?", job.Grant.Installation.ID, job.Grant.Installation.ProviderTokenCiphertext).
			Update("provider_token_ciphertext", rotated).Error; err != nil {
			return err
		}
	}
	template, ok := notificationTemplates[job.EventType]
	if !ok {
		return s.finishJob(ctx, job, model.JobStatusFailed, "unsupported_event", "")
	}
	notification := provider.Notification{
		ID: job.ID, Token: providerToken, Platform: job.Grant.Installation.Platform,
		Environment: job.Grant.Installation.Environment,
		Title:       template.Title, Body: template.Body, Event: job.EventType,
		GrantID: job.GrantID, RouteToken: job.RouteToken,
		CollapseKey: job.CollapseKey, RequestIdentifier: job.ProviderRequestID,
		ExpiresAt: job.ExpiresAt,
	}
	if identifierProvider, ok := pushProvider.(provider.RequestIdentifierProvider); ok && notification.RequestIdentifier == "" {
		identifierCtx, cancelIdentifier := context.WithTimeout(ctx, providerSendLimit)
		identifier, identifierErr := identifierProvider.NewRequestIdentifier(identifierCtx)
		cancelIdentifier()
		if identifierErr != nil {
			return s.handleProviderError(ctx, job, identifierErr)
		}
		updated := s.db.WithContext(ctx).Model(&model.Job{}).
			Where("id = ? AND status = ? AND lock_token = ?", job.ID, model.JobStatusSending, job.LockToken).
			Update("provider_request_id", identifier)
		if updated.Error != nil || updated.RowsAffected != 1 {
			return updated.Error
		}
		notification.RequestIdentifier = identifier
	}
	sendCtx, cancelSend := context.WithTimeout(ctx, providerSendLimit)
	defer cancelSend()
	receipt, err := pushProvider.Send(sendCtx, notification)
	if err == nil {
		return s.finishJob(ctx, job, model.JobStatusAccepted, "", receipt.MessageID)
	}
	return s.handleProviderError(ctx, job, err)
}

func (s *Service) handleProviderError(ctx context.Context, job model.Job, err error) error {
	var sendErr *provider.SendError
	if !errors.As(err, &sendErr) {
		sendErr = &provider.SendError{Kind: provider.ErrorTransient, Code: "provider_error", Err: err}
	}
	errorCode := safeErrorCode(sendErr.Code)
	if errorCode == "" {
		errorCode = "provider_error"
	}
	switch sendErr.Kind {
	case provider.ErrorInvalidDevice:
		return s.disableInstallation(ctx, job, errorCode)
	case provider.ErrorTransient:
		return s.retryJob(ctx, job, errorCode)
	default:
		return s.finishJob(ctx, job, model.JobStatusFailed, errorCode, "")
	}
}

func (s *Service) retryJob(ctx context.Context, job model.Job, code string) error {
	now := s.now().UTC()
	backoff := time.Duration(math.Pow(2, float64(min(job.Attempts, 6)))) * time.Second
	nextAttempt := now.Add(backoff)
	if job.Attempts >= maxAttempts || !nextAttempt.Before(job.ExpiresAt) {
		return s.finishJob(ctx, job, model.JobStatusFailed, safeErrorCode(code), "")
	}
	return s.db.WithContext(ctx).Model(&model.Job{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, model.JobStatusSending, job.LockToken).
		Updates(map[string]any{
			"status": model.JobStatusRetry, "next_attempt_at": nextAttempt,
			"locked_at": nil, "lock_token": "",
			"last_error_code": safeErrorCode(code), "updated_at": now,
		}).Error
}

func (s *Service) disableInstallation(ctx context.Context, job model.Job, code string) error {
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		owned := tx.Model(&model.Job{}).
			Where("id = ? AND status = ? AND lock_token = ?", job.ID, model.JobStatusSending, job.LockToken).
			Updates(map[string]any{
				"status": model.JobStatusFailed, "locked_at": nil, "lock_token": "",
				"last_error_code": safeErrorCode(code), "updated_at": now,
			})
		if owned.Error != nil {
			return owned.Error
		}
		if owned.RowsAffected != 1 {
			return nil
		}
		disabled := tx.Model(&model.Installation{}).
			Where("id = ? AND provider_token_hash = ?", job.Grant.InstallationID, job.Grant.Installation.ProviderTokenHash).
			Updates(map[string]any{"status": model.InstallationStatusDisabled, "updated_at": now})
		if disabled.Error != nil || disabled.RowsAffected == 0 {
			return disabled.Error
		}
		if err := revokeActiveGrants(tx, job.Grant.InstallationID, now); err != nil {
			return err
		}
		grantIDs := tx.Model(&model.Grant{}).Select("id").Where("installation_id = ?", job.Grant.InstallationID)
		return tx.Model(&model.Job{}).
			Where("grant_id IN (?) AND status IN ?", grantIDs, []string{model.JobStatusQueued, model.JobStatusRetry, model.JobStatusSending}).
			Updates(map[string]any{
				"status": model.JobStatusFailed, "locked_at": nil, "lock_token": "",
				"last_error_code": safeErrorCode(code), "updated_at": now,
			}).Error
	})
}

func (s *Service) renewJobLease(ctx context.Context, job model.Job) (bool, error) {
	now := s.now().UTC()
	result := s.db.WithContext(ctx).Model(&model.Job{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, model.JobStatusSending, job.LockToken).
		Updates(map[string]any{"locked_at": now, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (s *Service) finishJob(ctx context.Context, job model.Job, status, code, providerMessageID string) error {
	now := s.now().UTC()
	return s.db.WithContext(ctx).Model(&model.Job{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, model.JobStatusSending, job.LockToken).
		Updates(map[string]any{
			"status": status, "locked_at": nil, "lock_token": "", "last_error_code": safeErrorCode(code),
			"provider_message_id": providerMessageID, "updated_at": now,
		}).Error
}

func safeErrorCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) > 120 {
		return value[:120]
	}
	return value
}

type notificationTemplate struct {
	Title string
	Body  string
}

var notificationTemplates = map[string]notificationTemplate{
	EventMessageCreated: {Title: "即应", Body: "你收到一条新消息"},
}
