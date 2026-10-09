package message

import (
	"encoding/json"
	"errors"
	"time"

	appapp "app/internal/application/app"
	"app/internal/application/conversationaccess"
	"app/internal/appregistry"
	"app/internal/store"

	"gorm.io/gorm"
)

const appEventMessageCreated = "message.created"

type appMessageCreatedPayload struct {
	Conversation appMessageConversationPayload `json:"conversation"`
	Message      appMessagePayload             `json:"message"`
	Sender       appMessageSenderPayload       `json:"sender"`
}

type appMessageConversationPayload struct {
	OwnerAppID     string                           `json:"owner_app_id,omitempty"`
	CreatedByAppID string                           `json:"created_by_app_id,omitempty"`
	ID             string                           `json:"id"`
	Name           string                           `json:"name"`
	Parent         *appMessageConversationReference `json:"parent,omitempty"`
	Source         *appMessageTopicSourcePayload    `json:"source_message,omitempty"`
	Type           string                           `json:"type"`
}

type appMessageConversationReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type appMessageTopicSourcePayload struct {
	ID  string `json:"id"`
	Seq int64  `json:"seq"`
}

type appMessagePayload struct {
	Body             json.RawMessage `json:"body"`
	CreatedAt        time.Time       `json:"created_at"`
	ID               string          `json:"id"`
	ReplyToMessageID string          `json:"reply_to_message_id,omitempty"`
	Seq              int64           `json:"seq"`
	Summary          string          `json:"summary"`
}

type appMessageSenderPayload struct {
	Email    string `json:"email,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Type     string `json:"type"`
}

func createAppMessageEventOutbox(db *gorm.DB, access conversationaccess.Context, sender store.User, message store.Message) ([]AppEvent, error) {
	conversation := access.Conversation
	var appIDs []string
	var ownerAppID string
	switch conversation.Kind {
	case store.ConversationKindApp:
		var ok bool
		var err error
		ownerAppID, ok, err = findMessageConversationAppID(db, conversation.ID)
		if err != nil || !ok {
			return nil, err
		}
		appIDs = []string{ownerAppID}
		if !appregistry.IsAIAssistantAppID(ownerAppID) {
			mentioned, err := findMentionedGroupAppIDs(db, conversation.ID, message.Body)
			if err != nil {
				return nil, err
			}
			if containsAppID(mentioned, appregistry.AIAssistantAppID) {
				appIDs = []string{appregistry.AIAssistantAppID}
			}
		}
	case store.ConversationKindGroup:
		var err error
		appIDs, err = findMentionedGroupAppIDs(db, conversation.ID, message.Body)
		if err != nil {
			return nil, err
		}
	case store.ConversationKindDirect:
		mentioned, err := findMentionedGroupAppIDs(db, conversation.ID, message.Body)
		if err != nil {
			return nil, err
		}
		if containsAppID(mentioned, appregistry.AIAssistantAppID) {
			appIDs = []string{appregistry.AIAssistantAppID}
		}
	case store.ConversationKindTopic:
		var err error
		appIDs, err = conversationaccess.ActiveTopicParticipantIDs(db, access, store.ConversationMemberTypeApp)
		if err != nil {
			return nil, err
		}
		mentioned, err := findMentionedGroupAppIDs(db, access.MembershipConversationID, message.Body)
		if err != nil {
			return nil, err
		}
		if access.ParentConversation != nil && access.ParentConversation.Kind == store.ConversationKindApp {
			ownerAppID, _, err = findMessageConversationAppID(db, access.MembershipConversationID)
			if err != nil {
				return nil, err
			}
			if !appregistry.IsAIAssistantAppID(ownerAppID) && containsAppID(mentioned, appregistry.AIAssistantAppID) {
				appIDs = []string{appregistry.AIAssistantAppID}
			}
		}
		if !containsAppID(mentioned, appregistry.AIAssistantAppID) &&
			!(access.ParentConversation != nil && access.ParentConversation.Kind == store.ConversationKindApp && appregistry.IsAIAssistantAppID(ownerAppID)) {
			appIDs = withoutAppID(appIDs, appregistry.AIAssistantAppID)
		}
	default:
		return nil, nil
	}
	appIDs, err := lockAndFilterActiveConversationApps(db, access.MembershipConversationID, appIDs)
	if err != nil {
		return nil, err
	}
	if len(appIDs) == 0 {
		return nil, nil
	}
	conversationPayload := appMessageConversationPayload{ID: conversation.ID, Name: conversation.Name, Type: conversation.Kind, OwnerAppID: ownerAppID}
	if access.IsTopic() && access.ParentConversation != nil && access.Topic != nil {
		if access.Topic.CreatedByAppID != nil {
			conversationPayload.CreatedByAppID = *access.Topic.CreatedByAppID
		}
		conversationPayload.Parent = &appMessageConversationReference{
			ID: access.ParentConversation.ID, Name: access.ParentConversation.Name, Type: access.ParentConversation.Kind,
		}
		conversationPayload.Source = &appMessageTopicSourcePayload{ID: access.Topic.SourceMessageID, Seq: access.Topic.SourceMessageSeq}
	}
	payload := appMessageCreatedPayload{
		Conversation: conversationPayload,
		Message:      appMessagePayload{Body: message.Body, CreatedAt: message.CreatedAt, ID: message.ID, ReplyToMessageID: optionalString(message.ReplyToMessageID), Seq: message.Seq, Summary: message.Summary},
		Sender:       appMessageSenderPayload{Email: sender.Email, ID: sender.ID, Name: sender.Name, Nickname: sender.Nickname, Type: store.MessageSenderTypeUser},
	}
	result := make([]AppEvent, 0, len(appIDs))
	for _, appID := range appIDs {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		stored := store.AppEventOutbox{AppID: appID, Event: appEventMessageCreated, Payload: raw, CreatedAt: time.Now().UTC()}
		if err := db.Create(&stored).Error; err != nil {
			return nil, err
		}
		result = append(result, AppEvent{AppID: stored.AppID, Cursor: stored.ID, Event: stored.Event, Payload: stored.Payload})
	}
	return result, nil
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// lockAndFilterActiveConversationApps serializes event creation with app
// authorization updates and deletion. Rechecking membership after the app-row
// lock prevents an event selected from a stale membership snapshot from being
// queued after access has been revoked.
func lockAndFilterActiveConversationApps(db *gorm.DB, conversationID string, candidateIDs []string) ([]string, error) {
	if len(candidateIDs) == 0 {
		return nil, nil
	}
	lockedApps, err := appapp.LockUsableApps(db, candidateIDs)
	if err != nil {
		return nil, err
	}
	locked := make(map[string]struct{}, len(lockedApps))
	for _, app := range lockedApps {
		locked[app.ID] = struct{}{}
	}
	var members []store.ConversationMember
	if err := db.Select("member_id").Where(
		"conversation_id = ? AND member_type = ? AND member_id IN ? AND left_at IS NULL",
		conversationID, store.ConversationMemberTypeApp, candidateIDs,
	).Find(&members).Error; err != nil {
		return nil, err
	}
	active := make(map[string]struct{}, len(members))
	for _, member := range members {
		active[member.MemberID] = struct{}{}
	}
	result := make([]string, 0, len(candidateIDs))
	for _, appID := range candidateIDs {
		if _, ok := locked[appID]; !ok {
			continue
		}
		if _, ok := active[appID]; ok {
			result = append(result, appID)
		}
	}
	return result, nil
}

func findMentionedGroupAppIDs(db *gorm.DB, conversationID string, body json.RawMessage) ([]string, error) {
	targets := parseMessageMentionTargets(body)
	targetSet := make(map[string]struct{}, len(targets))
	targetIDs := make([]string, 0, len(targets))
	for _, target := range targets {
		if target.All || target.MemberType != store.ConversationMemberTypeApp {
			continue
		}
		if _, ok := targetSet[target.MemberID]; ok {
			continue
		}
		targetSet[target.MemberID] = struct{}{}
		targetIDs = append(targetIDs, target.MemberID)
	}
	if len(targetIDs) == 0 {
		return nil, nil
	}
	var members []store.ConversationMember
	if err := db.Where(
		"conversation_id = ? AND member_type = ? AND member_id IN ? AND left_at IS NULL",
		conversationID, store.ConversationMemberTypeApp, targetIDs,
	).Find(&members).Error; err != nil {
		return nil, err
	}
	membership := make(map[string]struct{}, len(members))
	for _, member := range members {
		membership[member.MemberID] = struct{}{}
	}
	result := make([]string, 0, len(targetIDs))
	for _, id := range targetIDs {
		if _, ok := membership[id]; ok {
			result = append(result, id)
		}
	}
	return result, nil
}

func findMessageConversationAppID(db *gorm.DB, conversationID string) (string, bool, error) {
	var relation store.AppConversation
	err := db.First(&relation, "conversation_id = ?", conversationID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return relation.AppID, true, nil
}

func containsAppID(ids []string, target string) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

func withoutAppID(ids []string, target string) []string {
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != target {
			result = append(result, id)
		}
	}
	return result
}
