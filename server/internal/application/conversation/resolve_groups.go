package conversation

import (
	"context"

	"app/internal/store"
)

// ResolveGroups is independent of the recent-conversation list's 30-item limit.
// Private rosters and permissions are only returned to active group members.
func (s *Service) ResolveGroups(ctx context.Context, accountID string, ids []string) ([]Item, error) {
	db := s.db.WithContext(ctx)
	var groups []store.Conversation
	if len(ids) == 0 {
		return []Item{}, nil
	}
	if err := db.Model(&store.Conversation{}).
		Joins("JOIN conversation_members cm ON cm.conversation_id = conversations.id").
		Joins("LEFT JOIN conversation_user_preferences cup ON cup.conversation_id = conversations.id AND cup.user_id = ?", accountID).
		Where("conversations.id IN ? AND conversations.kind = ? AND conversations.status = ?", ids, store.ConversationKindGroup, store.ConversationStatusActive).
		Where("cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL", store.ConversationMemberTypeUser, accountID).
		Where("cup.hidden_through_seq IS NULL OR conversations.last_message_seq > cup.hidden_through_seq").
		Find(&groups).Error; err != nil {
		return nil, internalError(err)
	}
	items := make([]Item, 0, len(groups))
	for _, group := range groups {
		item, err := s.loadItem(db, group, accountID)
		if err != nil {
			return nil, internalError(err)
		}
		items = append(items, item)
	}
	return items, nil
}
