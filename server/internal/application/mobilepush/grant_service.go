package mobilepush

import (
	"context"
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type grantService struct {
	db      *gorm.DB
	cipher  *TokenCipher
	enabled bool
	now     func() time.Time
}

func (s *grantService) Register(ctx context.Context, cmd RegisterGrantCommand) (Grant, error) {
	if !s.enabled {
		return Grant{}, failure("push_disabled", "当前服务未启用手机推送")
	}
	userID, err := normalizeUUID(cmd.UserID)
	if err != nil {
		return Grant{}, err
	}
	installationID, err := normalizeUUID(cmd.InstallationID)
	if err != nil {
		return Grant{}, err
	}
	gatewayGrantID, err := normalizeUUID(cmd.GatewayGrantID)
	if err != nil {
		return Grant{}, err
	}
	sessionID := ""
	if strings.TrimSpace(cmd.SessionID) != "" {
		sessionID, err = normalizeUUID(cmd.SessionID)
		if err != nil {
			return Grant{}, err
		}
	}
	cmd.SendToken = strings.TrimSpace(cmd.SendToken)
	cmd.Platform = strings.TrimSpace(cmd.Platform)
	now := s.now().UTC()
	if len(cmd.SendToken) < minSendToken || len(cmd.SendToken) > maxSendToken ||
		(cmd.Platform != "android" && cmd.Platform != "ios") ||
		!cmd.ExpiresAt.After(now) || cmd.ExpiresAt.After(now.Add(maxGrantLease)) {
		return Grant{}, failure("invalid_request", "推送授权格式错误")
	}

	if cmd.SessionID == "" {
		return Grant{}, failure("unauthorized", "登录状态已失效")
	}
	var stored store.UserPushGrant
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationKey(tx, "user:"+userID); err != nil {
			return err
		}
		if err := store.LockMobilePushInstallation(tx, installationID); err != nil {
			return err
		}
		if err := lockRegistrationKey(tx, "grant:"+gatewayGrantID); err != nil {
			return err
		}
		var session store.UserSession
		if err := tx.Where(
			"id = ? AND user_id = ? AND expires_at > ?", sessionID, userID, now,
		).First(&session).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return failure("unauthorized", "登录状态已失效")
			}
			return err
		}
		queryErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("installation_id = ?", installationID).First(&stored).Error
		switch {
		case queryErr == nil:
		case errors.Is(queryErr, gorm.ErrRecordNotFound):
			stored.ID = uuid.NewString()
			stored.CreatedAt = now
		default:
			return queryErr
		}
		var duplicateCount int64
		if err := tx.Model(&store.UserPushGrant{}).
			Where("gateway_grant_id = ? AND id <> ?", gatewayGrantID, stored.ID).
			Count(&duplicateCount).Error; err != nil {
			return err
		}
		if duplicateCount > 0 {
			return failure("grant_conflict", "推送授权已被其他安装实例使用")
		}
		wasActiveSlot := stored.ID != "" && stored.UserID == userID &&
			stored.Status == GrantStatusActive && stored.ExpiresAt.After(now)
		if !wasActiveSlot {
			var userGrantCount int64
			if err := tx.Model(&store.UserPushGrant{}).
				Where("user_id = ? AND id <> ? AND status = ? AND expires_at > ?", userID, stored.ID, GrantStatusActive, now).
				Count(&userGrantCount).Error; err != nil {
				return err
			}
			if userGrantCount >= maxGrantsPerUser {
				return failure("grant_limit_reached", "当前账号绑定的推送设备数量已达上限")
			}
		}
		if stored.ID != "" && (stored.UserID != userID || stored.GatewayGrantID != gatewayGrantID) {
			if err := tx.Where("grant_id = ?", stored.ID).Delete(&store.MobilePushJob{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&stored).Error; err != nil {
				return err
			}
			stored = store.UserPushGrant{ID: uuid.NewString(), CreatedAt: now}
		}
		ciphertext, err := s.cipher.Encrypt(cmd.SendToken, []byte(stored.ID))
		if err != nil {
			return err
		}
		stored.UserID = userID
		stored.SessionID = sessionID
		stored.InstallationID = installationID
		stored.GatewayGrantID = gatewayGrantID
		stored.SendTokenCiphertext = ciphertext
		stored.Platform = cmd.Platform
		sessionExpiry := session.ExpiresAt.UTC()
		if session.RefreshTokenHash != nil && session.RefreshExpiresAt != nil && session.RefreshAbsoluteExpiresAt != nil {
			sessionExpiry = minTime(*session.RefreshExpiresAt, *session.RefreshAbsoluteExpiresAt)
		}
		stored.ExpiresAt = minTime(cmd.ExpiresAt.UTC(), sessionExpiry)
		stored.Status = GrantStatusActive
		stored.LastSeenAt = now
		stored.UpdatedAt = now
		return tx.Save(&stored).Error
	})
	if err != nil {
		return Grant{}, err
	}
	return Grant{
		InstallationID: stored.InstallationID, GatewayGrantID: stored.GatewayGrantID,
		Platform: stored.Platform, ExpiresAt: stored.ExpiresAt,
	}, nil
}

func (s *grantService) Revoke(ctx context.Context, userID, installationID, gatewayGrantID string) error {
	userID, err := normalizeUUID(userID)
	if err != nil {
		return err
	}
	installationID, err = normalizeUUID(installationID)
	if err != nil {
		return err
	}
	gatewayGrantID, err = normalizeUUID(gatewayGrantID)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := store.LockMobilePushInstallation(tx, installationID); err != nil {
			return err
		}
		return tx.Where(
			"user_id = ? AND installation_id = ? AND gateway_grant_id = ?",
			userID, installationID, gatewayGrantID,
		).Delete(&store.UserPushGrant{}).Error
	})
}

func minTime(first, second time.Time) time.Time {
	if first.Before(second) {
		return first
	}
	return second
}
