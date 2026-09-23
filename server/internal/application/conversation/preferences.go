package conversation

import (
	"context"
	"errors"

	"app/internal/application/conversationaccess"
	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) SetMuted(ctx context.Context, cmd SetMuteCommand) (SetMuteResult, error) {
	accountID, err := normalizeUUID(cmd.AccountID, "当前用户 ID 格式错误")
	if err != nil {
		return SetMuteResult{}, invalidRequest(err.Error(), err)
	}
	conversationID, err := normalizeConversationID(cmd.ConversationID)
	if err != nil {
		return SetMuteResult{}, invalidRequest(err.Error(), err)
	}

	changed := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := requireConversationPreferenceAccess(tx, conversationID, accountID); err != nil {
			return err
		}
		var current store.ConversationUserPreference
		query := tx.First(&current, "user_id = ? AND conversation_id = ?", accountID, conversationID)
		if query.Error != nil && !errors.Is(query.Error, gorm.ErrRecordNotFound) {
			return query.Error
		}
		changed = current.NotificationMuted != cmd.Muted
		if !changed {
			return nil
		}
		now := s.now().UTC()
		preference := store.ConversationUserPreference{
			UserID: accountID, ConversationID: conversationID,
			NotificationMuted: cmd.Muted, CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}, {Name: "conversation_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"notification_muted": cmd.Muted,
				"updated_at":         now,
			}),
		}).Create(&preference).Error; err != nil {
			return err
		}
		return deleteEmptyConversationPreference(tx, accountID, conversationID)
	})
	if err != nil {
		return SetMuteResult{}, mapConversationPreferenceError(err)
	}
	result := SetMuteResult{ConversationID: conversationID, Muted: cmd.Muted}
	if changed && s.notifications != nil {
		s.notifications.PublishConversationMuteUpdated(ctx, []string{accountID}, ConversationMuteEvent{
			ConversationID: conversationID, Muted: cmd.Muted,
		})
	}
	return result, nil
}

func (s *Service) Dismiss(ctx context.Context, cmd DismissCommand) (DismissResult, error) {
	accountID, err := normalizeUUID(cmd.AccountID, "当前用户 ID 格式错误")
	if err != nil {
		return DismissResult{}, invalidRequest(err.Error(), err)
	}
	conversationID, err := normalizeConversationID(cmd.ConversationID)
	if err != nil {
		return DismissResult{}, invalidRequest(err.Error(), err)
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		read, _, err := markReadTransaction(tx, accountID, conversationID, nil)
		if err != nil {
			return err
		}
		now := s.now().UTC()
		preference := store.ConversationUserPreference{
			UserID: accountID, ConversationID: conversationID,
			HiddenThroughSeq: &read.LastReadSeq, CreatedAt: now, UpdatedAt: now,
		}
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}, {Name: "conversation_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"hidden_through_seq": read.LastReadSeq,
				"pinned":             false,
				"updated_at":         now,
			}),
		}).Create(&preference).Error
	})
	if err != nil {
		return DismissResult{}, mapConversationPreferenceError(err)
	}
	if s.notifications != nil {
		s.notifications.PublishConversationRemoved(ctx, []string{accountID}, conversationID)
	}
	return DismissResult{ConversationID: conversationID}, nil
}

func (s *Service) Restore(ctx context.Context, cmd RestoreCommand) (Item, error) {
	accountID, err := normalizeUUID(cmd.AccountID, "当前用户 ID 格式错误")
	if err != nil {
		return Item{}, invalidRequest(err.Error(), err)
	}
	conversationID, err := normalizeConversationID(cmd.ConversationID)
	if err != nil {
		return Item{}, invalidRequest(err.Error(), err)
	}
	db := s.db.WithContext(ctx)
	conversation, restored, err := s.restoreConversationPreference(db, accountID, conversationID)
	if err != nil {
		return Item{}, mapConversationPreferenceError(err)
	}
	item, err := s.loadItem(db, conversation, accountID)
	if err != nil {
		return Item{}, internalError(err)
	}
	s.publishConversationRestored(ctx, accountID, conversationID, restored)
	return item, nil
}

func (s *Service) restoreConversationPreference(db *gorm.DB, accountID, conversationID string) (store.Conversation, bool, error) {
	var conversation store.Conversation
	restored := false
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		conversation, err = requireConversationPreferenceAccess(tx, conversationID, accountID)
		if err != nil {
			return err
		}
		result := tx.Model(&store.ConversationUserPreference{}).
			Where("user_id = ? AND conversation_id = ? AND hidden_through_seq IS NOT NULL", accountID, conversationID).
			Updates(map[string]any{"hidden_through_seq": nil, "updated_at": s.now().UTC()})
		if result.Error != nil {
			return result.Error
		}
		restored = result.RowsAffected > 0
		return deleteEmptyConversationPreference(tx, accountID, conversationID)
	})
	return conversation, restored, err
}

func (s *Service) publishConversationRestored(ctx context.Context, accountID, conversationID string, restored bool) {
	if restored && s.notifications != nil {
		s.notifications.PublishConversationRestored(ctx, []string{accountID}, conversationID)
	}
}

func requireConversationPreferenceAccess(db *gorm.DB, conversationID, accountID string) (store.Conversation, error) {
	access, err := conversationaccess.Load(db, conversationID, false)
	if err != nil {
		return store.Conversation{}, err
	}
	if access.Conversation.Status != store.ConversationStatusActive ||
		(access.ParentConversation != nil && access.ParentConversation.Status != store.ConversationStatusActive) {
		return store.Conversation{}, ErrAccessDenied
	}
	member, err := conversationaccess.RequireUserMember(db, access, accountID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return store.Conversation{}, ErrAccessDenied
		}
		return store.Conversation{}, err
	}
	if !conversationaccess.TopicSourceVisibleToMember(access, member) {
		return store.Conversation{}, ErrAccessDenied
	}
	if access.IsTopic() {
		if _, err := conversationaccess.TopicParticipant(
			db, conversationID, store.ConversationMemberTypeUser, accountID,
		); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return store.Conversation{}, ErrAccessDenied
			}
			return store.Conversation{}, err
		}
	}
	return access.Conversation, nil
}

func deleteEmptyConversationPreference(db *gorm.DB, accountID, conversationID string) error {
	return db.Where(
		"user_id = ? AND conversation_id = ? AND pinned = ? AND notification_muted = ? AND hidden_through_seq IS NULL",
		accountID, conversationID, false, false,
	).Delete(&store.ConversationUserPreference{}).Error
}

func mapConversationPreferenceError(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return notFound("会话不存在", err)
	case errors.Is(err, ErrAccessDenied):
		return forbidden("无权访问会话", err)
	default:
		return internalError(err)
	}
}
