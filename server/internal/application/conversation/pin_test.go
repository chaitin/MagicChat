package conversation

import (
	"context"
	"testing"
	"time"

	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestConversationPinsAreUserScopedAndSortedByActivity(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 21, 2, 0, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "pin-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "pin-bob@example.com", "Bob", now)
	oldActivity := now.Add(-2 * time.Hour)
	recentActivity := now.Add(-time.Hour)
	oldConversation := insertPinTestConversation(t, db, alice, bob, "旧会话", oldActivity, now)
	recentConversation := insertPinTestConversation(t, db, alice, bob, "新会话", recentActivity, now)
	notifications := &pinNotificationRecorder{}
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"},
		DB:   db, Notifications: notifications, Now: func() time.Time { return now },
	})

	assertPinResult(t, service, alice.ID, oldConversation.ID, true)
	assertPinResult(t, service, alice.ID, oldConversation.ID, true)
	loadedPinned, err := service.loadItem(db, oldConversation, alice.ID)
	if err != nil || !loadedPinned.Pinned {
		t.Fatalf("load pinned conversation = %#v, err = %v", loadedPinned, err)
	}
	aliceList, err := service.List(context.Background(), ListCommand{AccountID: alice.ID})
	if err != nil {
		t.Fatalf("list Alice conversations: %v", err)
	}
	assertConversationOrder(t, aliceList.Conversations, []string{
		builtinAssistantConversationID(alice.ID), oldConversation.ID, recentConversation.ID,
	})
	if !aliceList.Conversations[0].Pinned || !aliceList.Conversations[1].Pinned || aliceList.Conversations[2].Pinned {
		t.Fatalf("Alice pin states = [%v %v %v]", aliceList.Conversations[0].Pinned, aliceList.Conversations[1].Pinned, aliceList.Conversations[2].Pinned)
	}

	bobList, err := service.List(context.Background(), ListCommand{AccountID: bob.ID})
	if err != nil {
		t.Fatalf("list Bob conversations: %v", err)
	}
	assertConversationOrder(t, bobList.Conversations, []string{
		builtinAssistantConversationID(bob.ID), recentConversation.ID, oldConversation.ID,
	})
	if bobList.Conversations[1].Pinned || bobList.Conversations[2].Pinned {
		t.Fatalf("Alice pin leaked into Bob list: %#v", bobList.Conversations)
	}

	assertPinResult(t, service, alice.ID, recentConversation.ID, true)
	aliceList, err = service.List(context.Background(), ListCommand{AccountID: alice.ID})
	if err != nil {
		t.Fatalf("list Alice conversations after second pin: %v", err)
	}
	assertConversationOrder(t, aliceList.Conversations, []string{
		builtinAssistantConversationID(alice.ID), recentConversation.ID, oldConversation.ID,
	})

	assertPinResult(t, service, alice.ID, recentConversation.ID, false)
	assertPinResult(t, service, alice.ID, recentConversation.ID, false)
	if len(notifications.events) != 3 {
		t.Fatalf("pin notification count = %d, want 3 changed mutations", len(notifications.events))
	}
	if _, err := service.SetPinned(context.Background(), SetPinCommand{
		AccountID: alice.ID, ConversationID: builtinAssistantConversationID(alice.ID), Pinned: false,
	}); err == nil || ErrorCodeOf(err) != CodeConflict {
		t.Fatalf("unpin built-in assistant error = %v, want conflict", err)
	}
}

func TestConversationPinRejectsTopics(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 21, 3, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "pin-topic-owner@example.com", "Owner", now)
	member := insertConversationTestUser(t, db, "pin-topic-member@example.com", "Member", now)
	parent, source := insertConversationTopicFixture(t, db, owner, member, now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	created, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(owner), ParentConversationID: parent.ID, SourceMessageID: source.ID,
	})
	if err != nil {
		t.Fatalf("create topic: %v", err)
	}
	if _, err := service.SetPinned(context.Background(), SetPinCommand{
		AccountID: member.ID, ConversationID: created.Conversation.ID, Pinned: true,
	}); err == nil || ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("non-participant pin error = %v, want forbidden", err)
	}
	if _, err := service.ParticipateTopic(context.Background(), ParticipateTopicCommand{
		Actor: actorFromTestUser(member), TopicConversationID: created.Conversation.ID,
	}); err != nil {
		t.Fatalf("participate topic: %v", err)
	}
	if _, err := service.SetPinned(context.Background(), SetPinCommand{
		AccountID: member.ID, ConversationID: created.Conversation.ID, Pinned: true,
	}); err == nil || ErrorCodeOf(err) != CodeInvalidRequest || ErrorMessage(err) != "话题不支持置顶" {
		t.Fatalf("topic pin error = %v, want invalid_request", err)
	}
	if _, err := service.ArchiveTopic(context.Background(), ArchiveTopicCommand{
		Actor: actorFromTestUser(owner), TopicConversationID: created.Conversation.ID,
	}); err != nil {
		t.Fatalf("archive topic: %v", err)
	}
	if _, err := service.SetPinned(context.Background(), SetPinCommand{
		AccountID: member.ID, ConversationID: created.Conversation.ID, Pinned: true,
	}); err == nil || ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("archived topic pin error = %v, want invalid_request", err)
	}
}

func insertPinTestConversation(t *testing.T, db *gorm.DB, owner, member store.User, name string, activity, now time.Time) store.Conversation {
	t.Helper()
	conversation := store.Conversation{
		ID: uuid.NewString(), Kind: store.ConversationKindGroup, Name: name,
		CreatedByUserID: owner.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate,
		CreatedAt: now.Add(-3 * time.Hour), UpdatedAt: now, LastMessageAt: &activity,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	members := []store.ConversationMember{
		{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: owner.ID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1},
		{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: member.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now, HistoryVisibleFromSeq: 1},
	}
	if err := db.Create(&members).Error; err != nil {
		t.Fatalf("create conversation members: %v", err)
	}
	return conversation
}

func assertPinResult(t *testing.T, service *Service, userID, conversationID string, pinned bool) {
	t.Helper()
	result, err := service.SetPinned(context.Background(), SetPinCommand{
		AccountID: userID, ConversationID: conversationID, Pinned: pinned,
	})
	if err != nil || result.ConversationID != conversationID || result.Pinned != pinned {
		t.Fatalf("set pinned = %#v, err = %v", result, err)
	}
}

func assertConversationOrder(t *testing.T, conversations []Item, want []string) {
	t.Helper()
	if len(conversations) != len(want) {
		t.Fatalf("conversation count = %d, want %d: %#v", len(conversations), len(want), conversations)
	}
	for index, id := range want {
		if conversations[index].ID != id {
			t.Fatalf("conversation %d = %s, want %s", index, conversations[index].ID, id)
		}
	}
}

type pinNotificationRecorder struct {
	events []ConversationPinEvent
}

func (*pinNotificationRecorder) PublishConversationMessage(context.Context, []string, Message) {}
func (*pinNotificationRecorder) PublishConversationReadUpdated(context.Context, []string, ReadResult) {
}
func (*pinNotificationRecorder) PublishConversationMuteUpdated(context.Context, []string, ConversationMuteEvent) {
}
func (*pinNotificationRecorder) PublishConversationRemoved(context.Context, []string, string) {}
func (*pinNotificationRecorder) PublishConversationRestored(context.Context, []string, string) {
}
func (*pinNotificationRecorder) PublishTopicEvent(context.Context, []string, TopicEvent) {}
func (r *pinNotificationRecorder) PublishConversationPinUpdated(_ context.Context, _ []string, event ConversationPinEvent) {
	r.events = append(r.events, event)
}
