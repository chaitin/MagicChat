package conversationaccess

import (
	"errors"
	"time"

	"app/internal/appregistry"
	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrTopicArchived = errors.New("topic is archived")

type Context struct {
	Conversation             store.Conversation
	MembershipConversationID string
	ParentConversation       *store.Conversation
	Topic                    *store.ConversationTopic
}

func Load(db *gorm.DB, conversationID string, lock bool) (Context, error) {
	var conversation store.Conversation
	if err := db.Session(&gorm.Session{}).First(&conversation, "id = ?", conversationID).Error; err != nil {
		return Context{}, err
	}
	result := Context{Conversation: conversation, MembershipConversationID: conversation.ID}
	if conversation.Kind != store.ConversationKindTopic {
		if lock {
			if err := db.Session(&gorm.Session{}).Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversationID).Error; err != nil {
				return Context{}, err
			}
			result.Conversation = conversation
		}
		return result, nil
	}
	var topic store.ConversationTopic
	if err := db.Session(&gorm.Session{}).First(&topic, "conversation_id = ?", conversation.ID).Error; err != nil {
		return Context{}, err
	}
	var parent store.Conversation
	parentQuery := db.Session(&gorm.Session{})
	if lock {
		parentQuery = parentQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := parentQuery.First(&parent, "id = ?", topic.ParentConversationID).Error; err != nil {
		return Context{}, err
	}
	if lock {
		if err := db.Session(&gorm.Session{}).Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversationID).Error; err != nil {
			return Context{}, err
		}
		if err := db.Session(&gorm.Session{}).Clauses(clause.Locking{Strength: "UPDATE"}).First(&topic, "conversation_id = ?", conversation.ID).Error; err != nil {
			return Context{}, err
		}
	}
	if conversation.Kind != store.ConversationKindTopic || topic.ParentConversationID != parent.ID {
		return Context{}, gorm.ErrRecordNotFound
	}
	result.Conversation = conversation
	result.MembershipConversationID = parent.ID
	result.ParentConversation = &parent
	result.Topic = &topic
	return result, nil
}

func (value Context) IsTopic() bool {
	return value.Topic != nil
}

func (value Context) IsArchived() bool {
	return value.Topic != nil && value.Topic.ArchivedAt != nil
}

func (value Context) EffectiveConversation() store.Conversation {
	if value.ParentConversation != nil {
		return *value.ParentConversation
	}
	return value.Conversation
}

func RequireUserMember(db *gorm.DB, value Context, userID string) (store.ConversationMember, error) {
	var member store.ConversationMember
	err := db.First(
		&member,
		"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		value.MembershipConversationID, store.ConversationMemberTypeUser, userID,
	).Error
	return member, err
}

func RequireAppMember(db *gorm.DB, value Context, appID string) (store.ConversationMember, error) {
	var member store.ConversationMember
	err := db.First(
		&member,
		"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		value.MembershipConversationID, store.ConversationMemberTypeApp, appID,
	).Error
	return member, err
}

// TopicSourceVisibleToMember keeps topic access inside the history window of
// the effective parent-conversation membership. Topic messages have their own
// sequence space, so this check must be performed against the source message
// sequence rather than against a topic message sequence.
func TopicSourceVisibleToMember(value Context, member store.ConversationMember) bool {
	if !value.IsTopic() {
		return true
	}
	return SourceMessageVisibleToMember(value.Topic.SourceMessageSeq, member)
}

func SourceMessageVisibleToMember(sourceMessageSeq int64, member store.ConversationMember) bool {
	if member.MemberType == store.ConversationMemberTypeApp && appregistry.IsAIAssistantAppID(member.MemberID) {
		return true
	}
	visibleFromSeq := member.HistoryVisibleFromSeq
	if visibleFromSeq < 1 {
		visibleFromSeq = 1
	}
	return sourceMessageSeq >= visibleFromSeq
}

func ActiveMembers(db *gorm.DB, value Context) ([]store.ConversationMember, error) {
	var members []store.ConversationMember
	err := db.Where("conversation_id = ? AND left_at IS NULL", value.MembershipConversationID).
		Order("joined_at ASC").Find(&members).Error
	return members, err
}

func ActiveUserIDs(db *gorm.DB, value Context) ([]string, error) {
	if value.IsTopic() {
		return ActiveTopicParticipantIDs(db, value, store.ConversationMemberTypeUser)
	}
	var ids []string
	err := db.Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_type = ? AND left_at IS NULL", value.MembershipConversationID, store.ConversationMemberTypeUser).
		Order("joined_at ASC").Pluck("member_id", &ids).Error
	return ids, err
}

func ActiveTopicParticipantIDs(db *gorm.DB, value Context, participantType string) ([]string, error) {
	if !value.IsTopic() {
		return nil, nil
	}
	var ids []string
	err := db.Model(&store.ConversationTopicParticipant{}).
		Select("conversation_topic_participants.participant_id").
		Joins("JOIN conversation_members cm ON cm.conversation_id = ? AND cm.member_type = conversation_topic_participants.participant_type AND cm.member_id = conversation_topic_participants.participant_id AND cm.left_at IS NULL", value.MembershipConversationID).
		Where("conversation_topic_participants.conversation_id = ? AND conversation_topic_participants.participant_type = ?", value.Conversation.ID, participantType).
		Where("? >= CASE WHEN cm.history_visible_from_seq < 1 THEN 1 ELSE cm.history_visible_from_seq END OR (cm.member_type = ? AND cm.member_id = ?)", value.Topic.SourceMessageSeq, store.ConversationMemberTypeApp, appregistry.AIAssistantAppID).
		Order("conversation_topic_participants.joined_at ASC").
		Pluck("conversation_topic_participants.participant_id", &ids).Error
	return ids, err
}

func TopicParticipant(db *gorm.DB, topicConversationID, participantType, participantID string) (store.ConversationTopicParticipant, error) {
	var participant store.ConversationTopicParticipant
	err := db.First(
		&participant,
		"conversation_id = ? AND participant_type = ? AND participant_id = ?",
		topicConversationID, participantType, participantID,
	).Error
	return participant, err
}

func EnsureTopicParticipant(db *gorm.DB, value Context, participantType, participantID, reason string, readSeq, mentionedSeq int64, now time.Time) error {
	if !value.IsTopic() {
		return nil
	}
	if value.IsArchived() {
		return ErrTopicArchived
	}
	participant := store.ConversationTopicParticipant{
		ConversationID: value.Conversation.ID, ParticipantType: participantType, ParticipantID: participantID,
		JoinedReason: reason, JoinedAt: now, HistoryVisibleFromSeq: 1,
		LastReadSeq: readSeq, LastMentionedSeq: mentionedSeq, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&participant).Error; err != nil {
		return err
	}
	updates := map[string]any{"updated_at": now}
	if readSeq > 0 {
		updates["last_read_seq"] = gorm.Expr("CASE WHEN last_read_seq > ? THEN last_read_seq ELSE ? END", readSeq, readSeq)
	}
	if mentionedSeq > 0 {
		updates["last_mentioned_seq"] = gorm.Expr("CASE WHEN last_mentioned_seq > ? THEN last_mentioned_seq ELSE ? END", mentionedSeq, mentionedSeq)
	}
	return db.Model(&store.ConversationTopicParticipant{}).
		Where("conversation_id = ? AND participant_type = ? AND participant_id = ?", value.Conversation.ID, participantType, participantID).
		Updates(updates).Error
}

func AdvanceTopicParticipantReadSeq(db *gorm.DB, topicConversationID, participantType, participantID string, seq int64, messageID *string, now time.Time) error {
	updates := map[string]any{
		"last_read_seq": gorm.Expr("CASE WHEN last_read_seq > ? THEN last_read_seq ELSE ? END", seq, seq),
		"updated_at":    now,
	}
	if messageID != nil {
		updates["last_read_message_id"] = gorm.Expr(
			"CASE WHEN last_read_seq <= ? THEN ? ELSE last_read_message_id END", seq, *messageID,
		)
	}
	return db.Model(&store.ConversationTopicParticipant{}).
		Where("conversation_id = ? AND participant_type = ? AND participant_id = ?", topicConversationID, participantType, participantID).
		Updates(updates).Error
}
