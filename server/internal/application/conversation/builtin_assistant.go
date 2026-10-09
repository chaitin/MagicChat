package conversation

import (
	"time"

	"app/internal/appregistry"
	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func withoutAssistantAppID(appIDs []string) []string {
	result := make([]string, 0, len(appIDs))
	for _, id := range appIDs {
		if !appregistry.IsAIAssistantAppID(id) {
			result = append(result, id)
		}
	}
	return result
}

func ensureAssistantMember(db *gorm.DB, conversationID string, visibleFromSeq int64, now time.Time) error {
	member := store.ConversationMember{
		ConversationID:        conversationID,
		MemberType:            store.ConversationMemberTypeApp,
		MemberID:              appregistry.AIAssistantAppID,
		Role:                  store.ConversationMemberRoleMember,
		JoinedAt:              now,
		HistoryVisibleFromSeq: visibleFromSeq,
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "conversation_id"}, {Name: "member_type"}, {Name: "member_id"}},
		DoUpdates: clause.Assignments(map[string]any{"left_at": nil}),
	}).Create(&member).Error
}
