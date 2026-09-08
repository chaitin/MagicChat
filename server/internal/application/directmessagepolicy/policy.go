package directmessagepolicy

import (
	"context"
	"errors"

	"app/internal/store"

	"gorm.io/gorm"
)

var (
	ErrFriendshipRequired   = errors.New("direct messaging requires friendship")
	ErrRecipientUnavailable = errors.New("direct message recipient unavailable")
)

type DirectorySettings interface {
	ContactDirectoryMode(context.Context) (string, error)
}

type Policy struct {
	settings DirectorySettings
}

func New(settings DirectorySettings) *Policy {
	return &Policy{settings: settings}
}

func (p *Policy) Require(db *gorm.DB, senderUserID, recipientUserID string) error {
	if p == nil {
		return nil
	}
	var blocked int64
	if err := db.Model(&store.UserBlock{}).
		Where("blocker_user_id = ? AND blocked_user_id = ?", recipientUserID, senderUserID).
		Count(&blocked).Error; err != nil {
		return err
	}
	if blocked > 0 {
		return ErrRecipientUnavailable
	}
	if p.settings == nil {
		return nil
	}
	mode, err := p.settings.ContactDirectoryMode(db.Statement.Context)
	if err != nil {
		return err
	}
	if mode != store.ContactDirectoryModeFriends {
		return nil
	}
	lowID, highID := senderUserID, recipientUserID
	if lowID > highID {
		lowID, highID = highID, lowID
	}
	var count int64
	if err := db.Model(&store.UserFriendship{}).
		Where("user_id_low = ? AND user_id_high = ?", lowID, highID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrFriendshipRequired
	}
	return nil
}
