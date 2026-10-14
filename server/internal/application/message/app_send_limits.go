package message

import (
	"math"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	appMessageSendWindow = time.Minute
	appMessageSendLimit  = 300
	appMessageUserLimit  = 30
)

// Lock before any conversation rows: all connections and server instances share
// this lock, and quota reservations roll back together with failed messages.
func lockAppMessageSend(tx *gorm.DB, appID string) error {
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&store.AppMessageSendState{AppID: appID}).Error; err != nil {
		return err
	}
	var state store.AppMessageSendState
	return tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&state, "app_id = ?", appID).Error
}

func (s *Service) appMessageSendTime(tx *gorm.DB) (time.Time, error) {
	if s.now != nil {
		return s.now().UTC(), nil
	}
	if tx.Dialector.Name() == "postgres" {
		var now time.Time
		err := tx.Raw("SELECT clock_timestamp()").Scan(&now).Error
		return now.UTC(), err
	}
	return time.Now().UTC(), nil
}

func reserveAppMessageSend(tx *gorm.DB, appID, clientMessageID string, recipient *string, now time.Time) error {
	cutoff := now.Add(-appMessageSendWindow)
	var recent []store.AppMessageSend
	if err := tx.Where("app_id = ? AND created_at > ?", appID, cutoff).
		Order("created_at ASC").Find(&recent).Error; err != nil {
		return err
	}
	var retryAt time.Time
	if len(recent) >= appMessageSendLimit {
		retryAt = recent[len(recent)-appMessageSendLimit].CreatedAt.Add(appMessageSendWindow)
	}
	if recipient != nil {
		lastSent := map[string]time.Time{}
		for _, sent := range recent {
			if sent.RecipientUserID != nil {
				lastSent[*sent.RecipientUserID] = sent.CreatedAt
			}
		}
		if _, exists := lastSent[*recipient]; !exists && len(lastSent) >= appMessageUserLimit {
			var earliestExpiry time.Time
			for _, last := range lastSent {
				expiry := last.Add(appMessageSendWindow)
				if earliestExpiry.IsZero() || expiry.Before(earliestExpiry) {
					earliestExpiry = expiry
				}
			}
			if earliestExpiry.After(retryAt) {
				retryAt = earliestExpiry
			}
		}
	}
	if !retryAt.IsZero() {
		return &Error{Code: CodeRateLimited, Message: "已达到应用消息发送频率上限", RetryAfterSeconds: max(1, int(math.Ceil(retryAt.Sub(now).Seconds())))}
	}
	// Keep at most one window of records per active application.
	if err := tx.Where("app_id = ? AND created_at <= ?", appID, cutoff).Delete(&store.AppMessageSend{}).Error; err != nil {
		return err
	}
	return tx.Create(&store.AppMessageSend{AppID: appID, ClientMessageID: clientMessageID, RecipientUserID: recipient, CreatedAt: now}).Error
}
