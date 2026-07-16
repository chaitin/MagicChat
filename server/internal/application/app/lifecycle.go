package app

import (
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

func revokeUnauthorizedAppMemberships(
	tx *gorm.DB,
	appID string,
	ownerID string,
	visibility string,
	grantedUserIDs []string,
	now time.Time,
) error {
	if visibility == store.AppVisibilityPublic {
		return nil
	}

	allowedUserIDs := []string{ownerID}
	if visibility == store.AppVisibilityRestricted {
		allowedUserIDs = append(allowedUserIDs, grantedUserIDs...)
	}
	if err := deleteUnauthorizedAppEvents(tx, appID, allowedUserIDs); err != nil {
		return err
	}
	unauthorizedAppConversations := tx.Model(&store.AppConversation{}).
		Select("conversation_id").
		Where("app_id = ? AND user_id NOT IN ?", appID, allowedUserIDs)
	if err := tx.Model(&store.ConversationMember{}).
		Where("conversation_id IN (?)", unauthorizedAppConversations).
		Where("member_type = ? AND member_id = ? AND left_at IS NULL", store.ConversationMemberTypeApp, appID).
		Update("left_at", now).Error; err != nil {
		return err
	}
	if err := tx.Where("app_id = ? AND user_id NOT IN ?", appID, allowedUserIDs).
		Delete(&store.AppConversation{}).Error; err != nil {
		return err
	}
	groupConversations := tx.Model(&store.Conversation{}).
		Select("id").Where("kind = ?", store.ConversationKindGroup)
	if err := tx.Model(&store.ConversationMember{}).
		Where("conversation_id IN (?)", groupConversations).
		Where("member_type = ? AND member_id = ? AND left_at IS NULL", store.ConversationMemberTypeApp, appID).
		Update("left_at", now).Error; err != nil {
		return err
	}
	return nil
}

func deleteStoredApp(tx *gorm.DB, stored *store.App, now time.Time) error {
	locked, err := lockAppForUpdate(tx, stored.ID)
	if err != nil {
		return err
	}
	*stored = locked
	if err := tx.Model(&store.ConversationMember{}).
		Where("member_type = ? AND member_id = ? AND left_at IS NULL", store.ConversationMemberTypeApp, stored.ID).
		Update("left_at", now).Error; err != nil {
		return err
	}
	if err := tx.Where("app_id = ?", stored.ID).Delete(&store.AppConversation{}).Error; err != nil {
		return err
	}
	if err := tx.Where("app_id = ?", stored.ID).Delete(&store.AppUserGrant{}).Error; err != nil {
		return err
	}
	if err := tx.Where("app_id = ?", stored.ID).Delete(&store.AppEventOutbox{}).Error; err != nil {
		return err
	}
	if err := tx.Where("app_id = ?", stored.ID).Delete(&store.AppEventAck{}).Error; err != nil {
		return err
	}
	return tx.Delete(stored).Error
}

func deleteUnauthorizedAppEvents(tx *gorm.DB, appID string, allowedUserIDs []string) error {
	return tx.Exec(`
		DELETE FROM app_event_outbox
		WHERE app_id = ?
		  AND (
			EXISTS (
				SELECT 1
				FROM app_conversations ac
				WHERE ac.app_id = ?
				  AND ac.user_id NOT IN ?
				  AND CAST(ac.conversation_id AS TEXT) = (app_event_outbox.payload -> 'conversation' ->> 'id')
			)
			OR EXISTS (
				SELECT 1
				FROM conversation_members cm
				JOIN conversations c ON c.id = cm.conversation_id
				WHERE cm.member_type = ?
				  AND cm.member_id = ?
				  AND cm.left_at IS NULL
				  AND c.kind = ?
				  AND CAST(cm.conversation_id AS TEXT) = (app_event_outbox.payload -> 'conversation' ->> 'id')
			)
		  )`,
		appID,
		appID,
		allowedUserIDs,
		store.ConversationMemberTypeApp,
		appID,
		store.ConversationKindGroup,
	).Error
}
