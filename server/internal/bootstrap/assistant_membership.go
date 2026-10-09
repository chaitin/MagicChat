package bootstrap

import (
	"app/internal/appregistry"

	"gorm.io/gorm"
)

func ensureAssistantConversationMembership(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
			INSERT INTO conversation_members (conversation_id, member_type, member_id, role, joined_at, history_visible_from_seq)
			SELECT id, 'app', ?, 'member', CURRENT_TIMESTAMP, last_message_seq + 1
			FROM conversations WHERE kind IN ('direct', 'group', 'app')
			ON CONFLICT (conversation_id, member_type, member_id) DO UPDATE SET left_at = NULL
		`, appregistry.AIAssistantAppID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO conversation_topic_participants
				(conversation_id, participant_type, participant_id, joined_reason, joined_at, history_visible_from_seq, created_at, updated_at)
			SELECT t.conversation_id, 'app', ?, 'automatic', CURRENT_TIMESTAMP, c.last_message_seq + 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
			FROM conversation_topics t
			JOIN conversations c ON c.id = t.conversation_id
			JOIN conversations parent ON parent.id = t.parent_conversation_id
			JOIN conversation_members m ON m.conversation_id = parent.id AND m.member_type = 'app' AND m.member_id = ? AND m.left_at IS NULL
			WHERE 1 = 1
			ON CONFLICT (conversation_id, participant_type, participant_id) DO NOTHING
		`, appregistry.AIAssistantAppID, appregistry.AIAssistantAppID).Error
	})
}
