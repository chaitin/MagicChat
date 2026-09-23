package conversation

import (
	"context"
	"testing"
	"time"

	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestConversationMuteIsUserScopedAndIncludedInItems(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 22, 2, 0, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "mute-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "mute-bob@example.com", "Bob", now)
	conversation := insertPinTestConversation(t, db, alice, bob, "免打扰会话", now.Add(-time.Hour), now)
	notifications := &preferenceNotificationRecorder{}
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"},
		DB:   db, Notifications: notifications, Now: func() time.Time { return now },
	})

	result, err := service.SetMuted(context.Background(), SetMuteCommand{
		AccountID: alice.ID, ConversationID: conversation.ID, Muted: true,
	})
	if err != nil || !result.Muted {
		t.Fatalf("set muted = %#v, err = %v", result, err)
	}
	if _, err := service.SetMuted(context.Background(), SetMuteCommand{
		AccountID: alice.ID, ConversationID: conversation.ID, Muted: true,
	}); err != nil {
		t.Fatalf("set muted idempotently: %v", err)
	}

	aliceItem, err := service.loadItem(db, conversation, alice.ID)
	if err != nil || !aliceItem.NotificationMuted {
		t.Fatalf("Alice item = %#v, err = %v", aliceItem, err)
	}
	bobItem, err := service.loadItem(db, conversation, bob.ID)
	if err != nil || bobItem.NotificationMuted {
		t.Fatalf("Bob item = %#v, err = %v", bobItem, err)
	}
	if len(notifications.muteEvents) != 1 || !notifications.muteEvents[0].Muted {
		t.Fatalf("mute events = %#v", notifications.muteEvents)
	}
}

func TestDismissedConversationReturnsAfterANewMessage(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 22, 3, 0, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "dismiss-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "dismiss-bob@example.com", "Bob", now)
	conversation := insertPinTestConversation(t, db, alice, bob, "暂时删除", now.Add(-time.Hour), now)
	lastMessageID := uuid.NewString()
	if err := db.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Updates(map[string]any{
		"last_message_id": lastMessageID, "last_message_seq": int64(5),
	}).Error; err != nil {
		t.Fatalf("seed last message state: %v", err)
	}
	conversation.LastMessageID = &lastMessageID
	conversation.LastMessageSeq = 5
	notifications := &preferenceNotificationRecorder{}
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"},
		DB:   db, Notifications: notifications, Now: func() time.Time { return now },
	})
	assertPinResult(t, service, alice.ID, conversation.ID, true)
	if _, err := service.SetMuted(context.Background(), SetMuteCommand{
		AccountID: alice.ID, ConversationID: conversation.ID, Muted: true,
	}); err != nil {
		t.Fatalf("mute conversation: %v", err)
	}

	result, err := service.Dismiss(context.Background(), DismissCommand{
		AccountID: alice.ID, ConversationID: conversation.ID,
	})
	if err != nil || result.ConversationID != conversation.ID {
		t.Fatalf("dismiss = %#v, err = %v", result, err)
	}
	listed, err := service.List(context.Background(), ListCommand{AccountID: alice.ID})
	if err != nil {
		t.Fatalf("list dismissed conversations: %v", err)
	}
	if findConversationItem(listed.Conversations, conversation.ID) != nil {
		t.Fatalf("dismissed conversation is still listed: %#v", listed.Conversations)
	}

	var preference store.ConversationUserPreference
	if err := db.First(&preference, "user_id = ? AND conversation_id = ?", alice.ID, conversation.ID).Error; err != nil {
		t.Fatalf("load preference: %v", err)
	}
	if preference.HiddenThroughSeq == nil || *preference.HiddenThroughSeq != 5 || preference.Pinned || !preference.NotificationMuted {
		t.Fatalf("preference after dismiss = %#v", preference)
	}
	var member store.ConversationMember
	if err := db.First(&member, "conversation_id = ? AND member_type = ? AND member_id = ?", conversation.ID, store.ConversationMemberTypeUser, alice.ID).Error; err != nil {
		t.Fatalf("load member: %v", err)
	}
	if member.LastReadSeq != 5 {
		t.Fatalf("last read seq = %d, want 5", member.LastReadSeq)
	}
	if len(notifications.removedConversationIDs) != 1 || notifications.removedConversationIDs[0] != conversation.ID {
		t.Fatalf("removed notifications = %#v", notifications.removedConversationIDs)
	}
	restored, err := service.Restore(context.Background(), RestoreCommand{
		AccountID: alice.ID, ConversationID: conversation.ID,
	})
	if err != nil || restored.ID != conversation.ID || !restored.NotificationMuted || restored.Pinned || restored.UnreadCount != 0 {
		t.Fatalf("restored conversation = %#v, err = %v", restored, err)
	}
	if len(notifications.restoredConversationIDs) != 1 || notifications.restoredConversationIDs[0] != conversation.ID {
		t.Fatalf("restored notifications = %#v", notifications.restoredConversationIDs)
	}
	if _, err := service.Dismiss(context.Background(), DismissCommand{
		AccountID: alice.ID, ConversationID: conversation.ID,
	}); err != nil {
		t.Fatalf("dismiss restored conversation: %v", err)
	}

	newMessageID := uuid.NewString()
	if err := db.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Updates(map[string]any{
		"last_message_id": newMessageID, "last_message_seq": int64(6),
	}).Error; err != nil {
		t.Fatalf("advance last message state: %v", err)
	}
	listed, err = service.List(context.Background(), ListCommand{AccountID: alice.ID})
	if err != nil {
		t.Fatalf("list reactivated conversations: %v", err)
	}
	reactivated := findConversationItem(listed.Conversations, conversation.ID)
	if reactivated == nil || reactivated.UnreadCount != 1 || !reactivated.NotificationMuted || reactivated.Pinned {
		t.Fatalf("reactivated conversation = %#v", reactivated)
	}
}

func TestOpeningDirectConversationRestoresItToTheList(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 22, 3, 30, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "restore-direct-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "restore-direct-bob@example.com", "Bob", now)
	notifications := &preferenceNotificationRecorder{}
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"},
		DB:   db, Notifications: notifications, Now: func() time.Time { return now },
	})
	opened, err := service.CreateDirect(context.Background(), CreateDirectCommand{
		Actor: actorFromTestUser(alice), UserID: bob.ID,
	})
	if err != nil {
		t.Fatalf("create direct conversation: %v", err)
	}
	if _, err := service.Dismiss(context.Background(), DismissCommand{
		AccountID: alice.ID, ConversationID: opened.Conversation.ID,
	}); err != nil {
		t.Fatalf("dismiss direct conversation: %v", err)
	}
	reopened, err := service.CreateDirect(context.Background(), CreateDirectCommand{
		Actor: actorFromTestUser(alice), UserID: bob.ID,
	})
	if err != nil || reopened.Conversation.ID != opened.Conversation.ID || reopened.Created {
		t.Fatalf("reopen direct conversation = %#v, err = %v", reopened, err)
	}
	listed, err := service.List(context.Background(), ListCommand{AccountID: alice.ID})
	if err != nil || findConversationItem(listed.Conversations, opened.Conversation.ID) == nil {
		t.Fatalf("list restored direct conversation = %#v, err = %v", listed, err)
	}
	if len(notifications.restoredConversationIDs) != 1 || notifications.restoredConversationIDs[0] != opened.Conversation.ID {
		t.Fatalf("restored notifications = %#v", notifications.restoredConversationIDs)
	}
}

func findConversationItem(items []Item, conversationID string) *Item {
	for index := range items {
		if items[index].ID == conversationID {
			return &items[index]
		}
	}
	return nil
}

type preferenceNotificationRecorder struct {
	muteEvents              []ConversationMuteEvent
	removedConversationIDs  []string
	restoredConversationIDs []string
}

func (*preferenceNotificationRecorder) PublishConversationMessage(context.Context, []string, Message) {
}
func (*preferenceNotificationRecorder) PublishConversationReadUpdated(context.Context, []string, ReadResult) {
}
func (r *preferenceNotificationRecorder) PublishConversationMuteUpdated(_ context.Context, _ []string, event ConversationMuteEvent) {
	r.muteEvents = append(r.muteEvents, event)
}
func (*preferenceNotificationRecorder) PublishConversationPinUpdated(context.Context, []string, ConversationPinEvent) {
}
func (r *preferenceNotificationRecorder) PublishConversationRemoved(_ context.Context, _ []string, conversationID string) {
	r.removedConversationIDs = append(r.removedConversationIDs, conversationID)
}
func (r *preferenceNotificationRecorder) PublishConversationRestored(_ context.Context, _ []string, conversationID string) {
	r.restoredConversationIDs = append(r.restoredConversationIDs, conversationID)
}
func (*preferenceNotificationRecorder) PublishTopicEvent(context.Context, []string, TopicEvent) {
}
