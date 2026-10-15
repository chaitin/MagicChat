package mobilepush

import (
	"context"
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) ReportPresence(ctx context.Context, cmd PresenceCommand) error {
	userID, err := normalizeUUID(cmd.UserID)
	if err != nil {
		return err
	}
	sessionID, err := normalizeUUID(cmd.SessionID)
	if err != nil {
		return err
	}
	if cmd.Platform != "ios" && cmd.Platform != "android" && cmd.Platform != "desktop" {
		return failure("invalid_request", "客户端平台格式错误")
	}
	now := s.now().UTC()
	var count int64
	if err := liveSessions(s.db.WithContext(ctx), now).Where("id = ? AND user_id = ?", sessionID, userID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return failure("unauthorized", "登录状态已失效")
	}
	presence := store.UserPushPresence{
		SessionID: sessionID, UserID: userID, Platform: cmd.Platform,
		Foreground: cmd.Foreground, ExpiresAt: now.Add(pushPresenceTTL), UpdatedAt: now,
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"user_id", "platform", "foreground", "expires_at", "updated_at"}),
	}).Create(&presence).Error
}

func liveSessions(db *gorm.DB, now time.Time) *gorm.DB {
	return db.Model(&store.UserSession{}).Where(
		"(expires_at > ? OR (refresh_token_hash IS NOT NULL AND refresh_expires_at > ? AND refresh_absolute_expires_at > ?))", now, now, now,
	)
}

func (s *Service) GetPreferences(ctx context.Context, userID string) (PushPreferences, error) {
	id, err := normalizeUUID(userID)
	if err != nil {
		return PushPreferences{}, err
	}
	var preference store.UserPushPreference
	err = s.db.WithContext(ctx).First(&preference, "user_id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PushPreferences{}, nil
	}
	return PushPreferences{PauseWhenDesktopActive: preference.PauseWhenDesktopActive}, err
}

func (s *Service) SetPreferences(ctx context.Context, userID string, input PushPreferences) (PushPreferences, error) {
	id, err := normalizeUUID(userID)
	if err != nil {
		return PushPreferences{}, err
	}
	preference := store.UserPushPreference{UserID: id, PauseWhenDesktopActive: input.PauseWhenDesktopActive, UpdatedAt: s.now().UTC()}
	err = s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"pause_when_desktop_active", "updated_at"}),
	}).Create(&preference).Error
	return input, err
}

func (s *Service) desktopActive(ctx context.Context, userID string, now time.Time) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&store.UserPushPresence{}).
		Where("user_id = ? AND platform = ? AND foreground = ? AND expires_at > ?", userID, "desktop", true, now).
		Where("session_id IN (?)", liveSessions(s.db.WithContext(ctx), now).Where("user_id = ?", userID).Select("id")).
		Count(&count).Error
	return count > 0, err
}

func (s *Service) sessionForeground(ctx context.Context, userID, sessionID, platform string, now time.Time) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).Model(&store.UserPushPresence{}).
		Where("session_id = ? AND user_id = ? AND platform = ? AND foreground = ? AND expires_at > ?", sessionID, userID, platform, true, now).
		Count(&count).Error
	return count > 0, err
}

func (s *Service) pushActivitySuppressionReason(ctx context.Context, job store.MobilePushJob, now time.Time) (string, error) {
	db := s.db.WithContext(ctx)
	var registry store.MessageRegistry
	if err := db.Select("seq").First(&registry, "id = ? AND conversation_id = ?", job.MessageID, job.ConversationID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "message_unavailable", nil
		}
		return "", err
	}
	var memberRead, topicRead int64
	if err := db.Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL", job.ConversationID, store.ConversationMemberTypeUser, job.UserID).
		Select("COALESCE(MAX(last_read_seq), 0)").Scan(&memberRead).Error; err != nil {
		return "", err
	}
	if err := db.Model(&store.ConversationTopicParticipant{}).
		Where("conversation_id = ? AND participant_type = ? AND participant_id = ?", job.ConversationID, store.ConversationMemberTypeUser, job.UserID).
		Select("COALESCE(MAX(last_read_seq), 0)").Scan(&topicRead).Error; err != nil {
		return "", err
	}
	if registry.Seq > 0 && max(memberRead, topicRead) >= registry.Seq {
		return "already_read", nil
	}
	foreground, err := s.sessionForeground(ctx, job.UserID, job.Grant.SessionID, job.Grant.Platform, now)
	if err != nil {
		return "", err
	}
	if foreground {
		return "mobile_foreground", nil
	}
	preferences, err := s.GetPreferences(ctx, job.UserID)
	if err != nil {
		return "", err
	}
	if preferences.PauseWhenDesktopActive {
		active, err := s.desktopActive(ctx, job.UserID, now)
		if err != nil {
			return "", err
		}
		if active {
			return "desktop_active", nil
		}
	}
	return "", nil
}

func (s *Service) GetStatus(ctx context.Context, userID, sessionID string) (PushStatus, error) {
	userID, err := normalizeUUID(userID)
	if err != nil {
		return PushStatus{}, err
	}
	sessionID, err = normalizeUUID(sessionID)
	if err != nil {
		return PushStatus{}, err
	}
	now := s.now().UTC()
	status := PushStatus{Enabled: s.enabled, DelaySeconds: int(pushDeliveryDelay / time.Second)}
	status.DesktopActive, err = s.desktopActive(ctx, userID, now)
	if err != nil {
		return status, err
	}
	var foregroundCount int64
	if err := s.db.WithContext(ctx).Model(&store.UserPushPresence{}).
		Where("user_id = ? AND session_id = ? AND platform IN ? AND foreground = ? AND expires_at > ?", userID, sessionID, []string{"ios", "android"}, true, now).
		Count(&foregroundCount).Error; err != nil {
		return status, err
	}
	status.Foreground = foregroundCount > 0
	var grant store.UserPushGrant
	err = s.db.WithContext(ctx).Where("user_id = ? AND session_id = ?", userID, sessionID).
		Order("updated_at DESC").First(&grant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return status, nil
	}
	if err != nil {
		return status, err
	}
	status.Registered = grant.Status == GrantStatusActive && grant.ExpiresAt.After(now)
	var job store.MobilePushJob
	err = s.db.WithContext(ctx).Where("grant_id = ?", grant.ID).Order("created_at DESC").Order("id DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return status, nil
	}
	if err != nil {
		return status, err
	}
	status.LastJob = &PushJobStatus{Status: job.Status, Reason: strings.TrimSpace(job.LastErrorCode), UpdatedAt: job.UpdatedAt}
	return status, nil
}
