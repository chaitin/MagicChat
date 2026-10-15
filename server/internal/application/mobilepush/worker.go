package mobilepush

import (
	"context"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	workerPollInterval = time.Second
	workerBatchSize    = 25
	workerLease        = time.Minute
	gatewaySendTimeout = 15 * time.Second
	maxJobAttempts     = 8
	terminalRetention  = 7 * 24 * time.Hour
)

func (s *Service) RunWorker(ctx context.Context) {
	if !s.enabled {
		return
	}
	ticker := time.NewTicker(workerPollInterval)
	defer ticker.Stop()
	for {
		expanded, err := s.ExpandEventBatch(ctx, workerBatchSize)
		if err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("expand mobile push events", "error", err)
		}
		processed, err := s.DispatchBatch(ctx, workerBatchSize)
		if err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("dispatch mobile push jobs", "error", err)
		}
		if ctx.Err() != nil {
			return
		}
		if expanded > 0 || processed > 0 {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) ExpandEventBatch(ctx context.Context, limit int) (int, error) {
	if !s.enabled || limit <= 0 {
		return 0, nil
	}
	events, err := s.claimEvents(ctx, limit)
	if err != nil {
		return 0, err
	}
	for index := range events {
		if err := s.expandEvent(ctx, events[index]); err != nil {
			return index, err
		}
	}
	return len(events), nil
}

func (s *Service) claimEvents(ctx context.Context, limit int) ([]store.MobilePushEvent, error) {
	now := s.now().UTC()
	var events []store.MobilePushEvent
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("status = ? AND updated_at < ?", EventStatusExpired, now.Add(-terminalRetention)).
			Delete(&store.MobilePushEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.MobilePushEvent{}).
			Where("status = ? AND locked_at < ?", EventStatusExpanding, now.Add(-workerLease)).
			Updates(map[string]any{
				"status": EventStatusRetry, "next_attempt_at": now,
				"locked_at": nil, "lock_token": "", "updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.MobilePushEvent{}).
			Where("status IN ? AND expires_at <= ?", []string{EventStatusQueued, EventStatusRetry}, now).
			Updates(map[string]any{
				"status": EventStatusExpired, "last_error_code": "ttl_expired", "updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status IN ? AND next_attempt_at <= ? AND expires_at > ?", []string{EventStatusQueued, EventStatusRetry}, now, now).
			Order("created_at ASC").Limit(limit).Find(&events).Error; err != nil {
			return err
		}
		for index := range events {
			events[index].Status = EventStatusExpanding
			events[index].Attempts++
			events[index].LockedAt = &now
			events[index].LockToken = uuid.NewString()
			if err := tx.Model(&store.MobilePushEvent{}).Where("id = ?", events[index].ID).
				Updates(map[string]any{
					"status": EventStatusExpanding, "attempts": events[index].Attempts,
					"locked_at": now, "lock_token": events[index].LockToken, "updated_at": now,
				}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return events, err
}

func (s *Service) expandEvent(ctx context.Context, event store.MobilePushEvent) error {
	now := s.now().UTC()
	owned := s.db.WithContext(ctx).Model(&store.MobilePushEvent{}).
		Where("id = ? AND status = ? AND lock_token = ?", event.ID, EventStatusExpanding, event.LockToken).
		Updates(map[string]any{"locked_at": now, "updated_at": now})
	if owned.Error != nil || owned.RowsAffected != 1 {
		return owned.Error
	}
	if err := s.fanoutEvent(ctx, event); err == nil {
		return nil
	} else if errors.Is(err, context.Canceled) {
		return err
	}
	nextAttempt := now.Add(time.Duration(1<<min(event.Attempts, 6)) * time.Second)
	if event.Attempts >= maxJobAttempts || !nextAttempt.Before(event.ExpiresAt) {
		return expireOwnedEvent(s.db.WithContext(ctx), event, now, "event_expansion_failed")
	}
	return s.db.WithContext(ctx).Model(&store.MobilePushEvent{}).
		Where("id = ? AND status = ? AND lock_token = ?", event.ID, EventStatusExpanding, event.LockToken).
		Updates(map[string]any{
			"status": EventStatusRetry, "next_attempt_at": nextAttempt,
			"locked_at": nil, "lock_token": "",
			"last_error_code": "event_expansion_failed", "updated_at": now,
		}).Error
}

func (s *Service) DispatchBatch(ctx context.Context, limit int) (int, error) {
	if !s.enabled || limit <= 0 {
		return 0, nil
	}
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

func (s *Service) claimJobs(ctx context.Context, limit int) ([]store.MobilePushJob, error) {
	now := s.now().UTC()
	var jobs []store.MobilePushJob
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now).Delete(&store.MobilePushRoute{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"status IN ? AND updated_at < ?",
			[]string{JobStatusSent, JobStatusFailed, JobStatusExpired, JobStatusSuppressed}, now.Add(-terminalRetention),
		).Delete(&store.MobilePushJob{}).Error; err != nil {
			return err
		}
		if err := tx.Where("status = ? AND updated_at < ?", GrantStatusDisabled, now.Add(-terminalRetention)).
			Delete(&store.UserPushGrant{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.MobilePushJob{}).
			Where("status = ? AND locked_at < ?", JobStatusSending, now.Add(-workerLease)).
			Updates(map[string]any{
				"status": JobStatusRetry, "next_attempt_at": now,
				"locked_at": nil, "lock_token": "", "updated_at": now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.UserPushGrant{}).
			Where("status = ? AND expires_at <= ?", GrantStatusActive, now).
			Updates(map[string]any{"status": GrantStatusDisabled, "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&store.MobilePushJob{}).
			Where("status IN ? AND expires_at <= ?", []string{JobStatusQueued, JobStatusRetry}, now).
			Updates(map[string]any{"status": JobStatusExpired, "last_error_code": "ttl_expired", "updated_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Preload("Grant").
			Where("mobile_push_jobs.status IN ? AND mobile_push_jobs.next_attempt_at <= ? AND mobile_push_jobs.expires_at > ?", []string{JobStatusQueued, JobStatusRetry}, now, now).
			Order("mobile_push_jobs.created_at ASC").Limit(limit).Find(&jobs).Error; err != nil {
			return err
		}
		for index := range jobs {
			jobs[index].Status = JobStatusSending
			jobs[index].Attempts++
			jobs[index].LockedAt = &now
			jobs[index].LockToken = uuid.NewString()
			if err := tx.Model(&store.MobilePushJob{}).Where("id = ?", jobs[index].ID).Updates(map[string]any{
				"status": JobStatusSending, "attempts": jobs[index].Attempts,
				"locked_at": now, "lock_token": jobs[index].LockToken, "updated_at": now,
			}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return jobs, err
}

func (s *Service) dispatchJob(ctx context.Context, job store.MobilePushJob) error {
	owned, err := s.renewLease(ctx, job)
	if err != nil || !owned {
		return err
	}
	now := s.now().UTC()
	if !job.ExpiresAt.After(now) {
		return s.finishJob(ctx, job, JobStatusExpired, "ttl_expired")
	}
	if job.UserID != job.Grant.UserID {
		return s.finishJob(ctx, job, JobStatusFailed, "grant_owner_changed")
	}
	if job.Grant.Status != GrantStatusActive || !job.Grant.ExpiresAt.After(now) {
		return s.finishJob(ctx, job, JobStatusFailed, "grant_inactive")
	}
	eligible, err := s.pushJobStillEligible(ctx, job, now)
	if err != nil {
		return err
	}
	if !eligible {
		return s.finishJob(ctx, job, JobStatusExpired, "policy_changed")
	}
	reason, err := s.pushActivitySuppressionReason(ctx, job, now)
	if err != nil {
		return err
	}
	if reason != "" {
		return s.finishJob(ctx, job, JobStatusSuppressed, reason)
	}
	sendToken, err := s.cipher.Decrypt(job.Grant.SendTokenCiphertext, []byte(job.Grant.ID))
	if err != nil {
		return s.finishJob(ctx, job, JobStatusFailed, "send_token_decryption_failed")
	}
	if s.cipher.NeedsRotation(job.Grant.SendTokenCiphertext) {
		rotated, err := s.cipher.Encrypt(sendToken, []byte(job.Grant.ID))
		if err != nil {
			return err
		}
		if err := s.db.WithContext(ctx).Model(&store.UserPushGrant{}).
			Where("id = ? AND send_token_ciphertext = ?", job.Grant.ID, job.Grant.SendTokenCiphertext).
			Update("send_token_ciphertext", rotated).Error; err != nil {
			return err
		}
	}
	routeToken, err := s.cipher.Decrypt(job.RouteTokenCiphertext, []byte(job.ID))
	if err != nil {
		return s.finishJob(ctx, job, JobStatusFailed, "route_token_decryption_failed")
	}
	if s.cipher.NeedsRotation(job.RouteTokenCiphertext) {
		rotated, err := s.cipher.Encrypt(routeToken, []byte(job.ID))
		if err != nil {
			return err
		}
		if err := s.db.WithContext(ctx).Model(&store.MobilePushJob{}).
			Where("id = ? AND status = ? AND lock_token = ?", job.ID, JobStatusSending, job.LockToken).
			Update("route_token_ciphertext", rotated).Error; err != nil {
			return err
		}
	}
	collapseDigest := s.cipher.BlindIndex("conversation\x00" + job.ConversationID)
	collapseKey := hex.EncodeToString(collapseDigest[:16])
	sendCtx, cancel := context.WithTimeout(ctx, gatewaySendTimeout)
	defer cancel()
	remainingTTL := job.ExpiresAt.Sub(now)
	ttlSeconds := int((remainingTTL + time.Second - 1) / time.Second)
	err = s.gateway.Send(
		sendCtx, job.Grant.GatewayGrantID, sendToken,
		job.ID+":"+job.Grant.GatewayGrantID,
		NotificationRequest{
			Event: "message.created", RouteToken: routeToken,
			CollapseKey: collapseKey, TTLSeconds: ttlSeconds,
		},
	)
	if err == nil {
		return s.finishJob(ctx, job, JobStatusSent, "")
	}
	var gatewayErr *GatewayError
	if !errors.As(err, &gatewayErr) {
		gatewayErr = &GatewayError{Kind: GatewayErrorRetry, Code: "gateway_error", Err: err}
	}
	code := safeCode(gatewayErr.Code)
	switch gatewayErr.Kind {
	case GatewayErrorRevoked:
		return s.disableGrant(ctx, job, code)
	case GatewayErrorRetry:
		return s.retryJob(ctx, job, code)
	default:
		return s.finishJob(ctx, job, JobStatusFailed, code)
	}
}

func (s *Service) renewLease(ctx context.Context, job store.MobilePushJob) (bool, error) {
	now := s.now().UTC()
	result := s.db.WithContext(ctx).Model(&store.MobilePushJob{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, JobStatusSending, job.LockToken).
		Updates(map[string]any{"locked_at": now, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (s *Service) retryJob(ctx context.Context, job store.MobilePushJob, code string) error {
	now := s.now().UTC()
	backoff := time.Duration(1<<min(job.Attempts, 6)) * time.Second
	nextAttempt := now.Add(backoff)
	if job.Attempts >= maxJobAttempts || !nextAttempt.Before(job.ExpiresAt) {
		return s.finishJob(ctx, job, JobStatusFailed, code)
	}
	return s.db.WithContext(ctx).Model(&store.MobilePushJob{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, JobStatusSending, job.LockToken).
		Updates(map[string]any{
			"status": JobStatusRetry, "next_attempt_at": nextAttempt,
			"locked_at": nil, "lock_token": "", "last_error_code": code, "updated_at": now,
		}).Error
}

func (s *Service) finishJob(ctx context.Context, job store.MobilePushJob, status, code string) error {
	now := s.now().UTC()
	return s.db.WithContext(ctx).Model(&store.MobilePushJob{}).
		Where("id = ? AND status = ? AND lock_token = ?", job.ID, JobStatusSending, job.LockToken).
		Updates(map[string]any{
			"status": status, "locked_at": nil, "lock_token": "",
			"last_error_code": code, "updated_at": now,
		}).Error
}

func (s *Service) disableGrant(ctx context.Context, job store.MobilePushJob, code string) error {
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		owned := tx.Model(&store.MobilePushJob{}).
			Where("id = ? AND status = ? AND lock_token = ?", job.ID, JobStatusSending, job.LockToken).
			Updates(map[string]any{
				"status": JobStatusFailed, "locked_at": nil, "lock_token": "",
				"last_error_code": code, "updated_at": now,
			})
		if owned.Error != nil || owned.RowsAffected != 1 {
			return owned.Error
		}
		disabled := tx.Model(&store.UserPushGrant{}).
			Where("id = ? AND gateway_grant_id = ?", job.GrantID, job.Grant.GatewayGrantID).
			Updates(map[string]any{"status": GrantStatusDisabled, "updated_at": now})
		if disabled.Error != nil || disabled.RowsAffected == 0 {
			return disabled.Error
		}
		return tx.Model(&store.MobilePushJob{}).
			Where("grant_id = ? AND status IN ?", job.GrantID, []string{JobStatusQueued, JobStatusRetry, JobStatusSending}).
			Updates(map[string]any{
				"status": JobStatusFailed, "locked_at": nil, "lock_token": "",
				"last_error_code": code, "updated_at": now,
			}).Error
	})
}

func safeCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "gateway_error"
	}
	if len(value) > 120 {
		return value[:120]
	}
	return value
}
