package conversation

import (
	"encoding/json"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	messageTypeSystemEvent              = "system_event"
	systemEventGroupMembersInvited      = "group_members_invited"
	systemEventGroupAvatarUpdated       = "group_avatar_updated"
	systemEventGroupVisibilityChanged   = "group_visibility_changed"
	systemEventGroupMemberJoined        = "group_member_joined"
	systemEventGroupMemberLeft          = "group_member_left"
	systemEventGroupMemberRemoved       = "group_member_removed"
	systemEventGroupNameUpdated         = "group_name_updated"
	systemEventGroupAnnouncementUpdated = "group_announcement_updated"
	systemEventTopicClosed              = "topic_closed"
	systemEventFriendshipCreated        = "friendship_created"
	groupMembersInvitedSummarySeparator = ","
)

type systemEventUserRef struct {
	DisplayName string `json:"display_name"`
	ID          string `json:"id"`
	Type        string `json:"type,omitempty"`
}

type groupMembersInvitedSystemEventBody struct {
	Event    string               `json:"event"`
	Invitees []systemEventUserRef `json:"invitees"`
	Inviter  systemEventUserRef   `json:"inviter"`
	Type     string               `json:"type"`
}

type groupAvatarUpdatedSystemEventBody struct {
	Actor systemEventUserRef `json:"actor"`
	Event string             `json:"event"`
	Type  string             `json:"type"`
}

type groupVisibilityChangedSystemEventBody struct {
	Actor      systemEventUserRef `json:"actor"`
	Event      string             `json:"event"`
	Type       string             `json:"type"`
	Visibility string             `json:"visibility"`
}

type groupMemberJoinedSystemEventBody struct {
	Actor systemEventUserRef `json:"actor"`
	Event string             `json:"event"`
	Type  string             `json:"type"`
}

type groupMemberLeftSystemEventBody struct {
	Actor systemEventUserRef `json:"actor"`
	Event string             `json:"event"`
	Type  string             `json:"type"`
}

type groupMemberRemovedSystemEventBody struct {
	Actor  systemEventUserRef `json:"actor"`
	Event  string             `json:"event"`
	Target systemEventUserRef `json:"target"`
	Type   string             `json:"type"`
}

type groupNameUpdatedSystemEventBody struct {
	Actor systemEventUserRef `json:"actor"`
	Event string             `json:"event"`
	Name  string             `json:"name"`
	Type  string             `json:"type"`
}

type groupAnnouncementUpdatedSystemEventBody struct {
	Actor        systemEventUserRef `json:"actor"`
	Announcement string             `json:"announcement"`
	Event        string             `json:"event"`
	Type         string             `json:"type"`
}

type topicClosedSystemEventBody struct {
	Actor systemEventUserRef `json:"actor"`
	Event string             `json:"event"`
	Type  string             `json:"type"`
}

type friendshipCreatedSystemEventBody struct {
	Event string `json:"event"`
	Type  string `json:"type"`
}

func createGroupMembersInvitedSystemMessage(db *gorm.DB, conversation *store.Conversation, inviter store.User, invitees []systemEventUserRef, now time.Time) (store.Message, error) {
	names := make([]string, 0, len(invitees))
	for _, invitee := range invitees {
		names = append(names, invitee.DisplayName)
	}
	displayName := userDisplayName(inviter)
	body, err := json.Marshal(groupMembersInvitedSystemEventBody{
		Event: systemEventGroupMembersInvited, Invitees: invitees,
		Inviter: systemEventUserRef{DisplayName: displayName, ID: inviter.ID}, Type: messageTypeSystemEvent,
	})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 邀请 "+strings.Join(names, groupMembersInvitedSummarySeparator)+" 加入群聊", now)
}

func createGroupAvatarUpdatedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupAvatarUpdatedSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupAvatarUpdated, Type: messageTypeSystemEvent})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 修改了群头像", now)
}

func createGroupVisibilityChangedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, visibility string, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	summary := displayName + " 将当前群设置为公开群"
	if visibility == store.ConversationVisibilityPrivate {
		summary = displayName + " 将当前群设为私有群"
	}
	body, err := json.Marshal(groupVisibilityChangedSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupVisibilityChanged, Type: messageTypeSystemEvent, Visibility: visibility})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, summary, now)
}

func createGroupMemberJoinedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupMemberJoinedSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupMemberJoined, Type: messageTypeSystemEvent})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 加入群聊", now)
}

func createGroupMemberLeftSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupMemberLeftSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupMemberLeft, Type: messageTypeSystemEvent})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 已退出群聊", now)
}

func createGroupMemberRemovedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, target systemEventUserRef, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupMemberRemovedSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupMemberRemoved, Target: target, Type: messageTypeSystemEvent})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 已将 "+target.DisplayName+" 移出群聊", now)
}

func createGroupMemberRoleUpdatedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, target systemEventUserRef, role string, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupMemberRoleUpdatedSystemEventBody{
		Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID},
		Event: "group_member_role_updated", Role: role, Target: target, Type: messageTypeSystemEvent,
	})
	if err != nil {
		return store.Message{}, err
	}
	action := "取消了 " + target.DisplayName + " 的管理员"
	if role == store.ConversationMemberRoleAdmin {
		action = "将 " + target.DisplayName + " 设为管理员"
	}
	return createSystemMessage(db, conversation, body, displayName+" "+action, now)
}

func createGroupNameUpdatedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, name string, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	body, err := json.Marshal(groupNameUpdatedSystemEventBody{Actor: systemEventUserRef{DisplayName: displayName, ID: actor.ID}, Event: systemEventGroupNameUpdated, Name: name, Type: messageTypeSystemEvent})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, displayName+" 修改群聊名称为 "+name, now)
}

func createGroupAnnouncementUpdatedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, announcement string, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	summary := displayName + " 更新了群公告"
	if announcement == "" {
		summary = displayName + " 清空了群公告"
	}
	body, err := json.Marshal(groupAnnouncementUpdatedSystemEventBody{
		Actor:        systemEventUserRef{DisplayName: displayName, ID: actor.ID},
		Announcement: announcement,
		Event:        systemEventGroupAnnouncementUpdated,
		Type:         messageTypeSystemEvent,
	})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, summary, now)
}

func createFriendshipCreatedSystemMessage(db *gorm.DB, conversation *store.Conversation, now time.Time) (store.Message, error) {
	body, err := json.Marshal(friendshipCreatedSystemEventBody{
		Event: systemEventFriendshipCreated,
		Type:  messageTypeSystemEvent,
	})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, "你们已成为好友，现在可以开始聊天了", now)
}

func createTopicClosedSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.User, now time.Time) (store.Message, error) {
	displayName := userDisplayName(actor)
	return createTopicClosedSystemMessageForActor(db, conversation, systemEventUserRef{
		DisplayName: displayName, ID: actor.ID, Type: store.MessageSenderTypeUser,
	}, now)
}

func createTopicClosedByAppSystemMessage(db *gorm.DB, conversation *store.Conversation, actor store.App, now time.Time) (store.Message, error) {
	displayName := strings.TrimSpace(actor.Name)
	if displayName == "" {
		displayName = "应用"
	}
	return createTopicClosedSystemMessageForActor(db, conversation, systemEventUserRef{
		DisplayName: displayName, ID: actor.ID, Type: store.MessageSenderTypeApp,
	}, now)
}

func createTopicClosedSystemMessageForActor(db *gorm.DB, conversation *store.Conversation, actor systemEventUserRef, now time.Time) (store.Message, error) {
	body, err := json.Marshal(topicClosedSystemEventBody{
		Actor: actor,
		Event: systemEventTopicClosed,
		Type:  messageTypeSystemEvent,
	})
	if err != nil {
		return store.Message{}, err
	}
	return createSystemMessage(db, conversation, body, actor.DisplayName+" 已将话题关闭", now)
}

func createSystemMessage(db *gorm.DB, conversation *store.Conversation, body json.RawMessage, summary string, now time.Time) (store.Message, error) {
	message := store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: conversation.LastMessageSeq + 1, SenderType: store.MessageSenderTypeSystem, Body: body, Summary: summary, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&message).Error; err != nil {
		return store.Message{}, err
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Updates(map[string]any{
		"last_message_at": message.CreatedAt, "last_message_id": message.ID, "last_message_seq": message.Seq,
		"last_message_summary": message.Summary, "updated_at": now,
	}).Error; err != nil {
		return store.Message{}, err
	}
	lastMessageAt := message.CreatedAt
	conversation.LastMessageAt = &lastMessageAt
	conversation.LastMessageID = &message.ID
	conversation.LastMessageSeq = message.Seq
	conversation.LastMessageSummary = message.Summary
	conversation.UpdatedAt = now
	return message, nil
}

func makeInviteeRefs(users []store.User, apps []store.App) []systemEventUserRef {
	refs := make([]systemEventUserRef, 0, len(users)+len(apps))
	for _, user := range users {
		refs = append(refs, systemEventUserRef{DisplayName: userDisplayName(user), ID: user.ID})
	}
	for _, app := range apps {
		refs = append(refs, systemEventUserRef{DisplayName: app.Name, ID: app.ID, Type: store.ConversationMemberTypeApp})
	}
	return refs
}

func loadMemberSystemRef(db *gorm.DB, memberType, memberID string) (systemEventUserRef, error) {
	switch memberType {
	case store.ConversationMemberTypeUser:
		var user store.User
		if err := db.First(&user, "id = ?", memberID).Error; err != nil {
			return systemEventUserRef{}, err
		}
		return systemEventUserRef{DisplayName: userDisplayName(user), ID: user.ID}, nil
	case store.ConversationMemberTypeApp:
		var app store.App
		if err := db.Unscoped().First(&app, "id = ?", memberID).Error; err != nil {
			return systemEventUserRef{}, err
		}
		return systemEventUserRef{DisplayName: app.Name, ID: app.ID, Type: store.ConversationMemberTypeApp}, nil
	default:
		return systemEventUserRef{}, gorm.ErrRecordNotFound
	}
}
