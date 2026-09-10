package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestTopicConversationListActivityFilterOmitsEmptyUUIDComparison(t *testing.T) {
	db := openConversationTestDB(t)
	cutoff := time.Date(2026, 7, 28, 1, 0, 0, 0, time.UTC)

	var conversations []store.Conversation
	emptyQuery := applyTopicConversationListActivityFilter(
		db.Session(&gorm.Session{DryRun: true}).Model(&store.Conversation{}),
		cutoff,
		"",
	).Find(&conversations)
	if emptyQuery.Error != nil {
		t.Fatalf("build empty include query: %v", emptyQuery.Error)
	}
	if sql := emptyQuery.Statement.SQL.String(); strings.Contains(sql, "conversations.id =") {
		t.Fatalf("empty include query contains UUID comparison: %s", sql)
	}

	includeID := uuid.NewString()
	includedQuery := applyTopicConversationListActivityFilter(
		db.Session(&gorm.Session{DryRun: true}).Model(&store.Conversation{}),
		cutoff,
		includeID,
	).Find(&conversations)
	if includedQuery.Error != nil {
		t.Fatalf("build included query: %v", includedQuery.Error)
	}
	if sql := includedQuery.Statement.SQL.String(); !strings.Contains(sql, "conversations.id =") {
		t.Fatalf("included query is missing UUID comparison: %s", sql)
	}
}

func TestListRejectsInvalidIncludedConversationID(t *testing.T) {
	db := openConversationTestDB(t)
	service := NewService(Dependencies{DB: db})

	_, err := service.List(context.Background(), ListCommand{
		AccountID: uuid.NewString(), IncludeConversationID: "not-a-uuid",
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("list error = %v, code = %s", err, ErrorCodeOf(err))
	}
}

func TestListIncludesParentConversationOutsideRecentLimit(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 28, 8, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "list-included-owner@example.com", "Owner", now)
	member := insertConversationTestUser(t, db, "list-included-member@example.com", "Member", now)
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"}, DB: db,
		Now: func() time.Time { return now },
	})

	oldest := insertPinTestConversation(t, db, owner, member, "oldest", now.Add(-time.Hour), now)
	for index := 0; index < clientConversationListLimit; index++ {
		insertPinTestConversation(t, db, owner, member, "recent", now.Add(time.Duration(index)*time.Minute), now)
	}

	listed, err := service.List(context.Background(), ListCommand{AccountID: owner.ID})
	if err != nil {
		t.Fatalf("list recent conversations: %v", err)
	}
	if conversationListItemIndex(listed.Conversations, oldest.ID) >= 0 {
		t.Fatal("oldest conversation unexpectedly appears in recent list")
	}

	included, err := service.List(context.Background(), ListCommand{
		AccountID: owner.ID, IncludeConversationID: oldest.ID,
	})
	if err != nil {
		t.Fatalf("list included conversation: %v", err)
	}
	if conversationListItemIndex(included.Conversations, oldest.ID) < 0 {
		t.Fatal("included conversation is missing from list")
	}
}

func TestListGroupsActiveTopicsUnderTheirParent(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "list-topic-owner@example.com", "Owner", now)
	member := insertConversationTestUser(t, db, "list-topic-member@example.com", "Member", now)
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"}, DB: db,
		Now: func() time.Time { return now },
	})

	activeParent, firstSource := insertConversationTopicFixture(t, db, owner, member, now.Add(-2*time.Hour))
	firstTopic, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(owner), ParentConversationID: activeParent.ID, SourceMessageID: firstSource.ID,
	})
	if err != nil {
		t.Fatalf("create first active topic: %v", err)
	}
	secondSource := store.Message{
		ID: uuid.NewString(), ConversationID: activeParent.ID, Seq: 2,
		SenderType: store.MessageSenderTypeUser, SenderID: &owner.ID,
		Body: json.RawMessage(`{"type":"text","content":"Second topic"}`), Summary: "Second topic",
		CreatedAt: now.Add(-119 * time.Minute), UpdatedAt: now.Add(-119 * time.Minute),
	}
	if err := db.Create(&secondSource).Error; err != nil {
		t.Fatalf("create second source: %v", err)
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", activeParent.ID).Updates(map[string]any{
		"last_message_at": secondSource.CreatedAt, "last_message_id": secondSource.ID,
		"last_message_seq": secondSource.Seq, "last_message_summary": secondSource.Summary,
	}).Error; err != nil {
		t.Fatalf("update active parent: %v", err)
	}
	secondTopic, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(owner), ParentConversationID: activeParent.ID, SourceMessageID: secondSource.ID,
	})
	if err != nil {
		t.Fatalf("create second active topic: %v", err)
	}
	setTopicListState(t, db, owner.ID, firstTopic.Conversation.ID, now.Add(-5*time.Minute), 1, 1)
	setTopicListState(t, db, owner.ID, secondTopic.Conversation.ID, now.Add(-10*time.Minute), 1, 1)
	if _, err := service.Dismiss(context.Background(), DismissCommand{
		AccountID: owner.ID, ConversationID: activeParent.ID,
	}); err != nil {
		t.Fatalf("dismiss active topic parent: %v", err)
	}

	recentParent := insertPinTestConversation(t, db, owner, member, "Recent parent", now.Add(-7*time.Minute), now)

	staleParent, staleSource := insertConversationTopicFixture(t, db, owner, member, now.Add(-20*time.Minute))
	staleTopic, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(owner), ParentConversationID: staleParent.ID, SourceMessageID: staleSource.ID,
	})
	if err != nil {
		t.Fatalf("create stale topic: %v", err)
	}
	setTopicListState(t, db, owner.ID, staleTopic.Conversation.ID, now.Add(-40*time.Minute), 1, 1)

	unreadParent, unreadSource := insertConversationTopicFixture(t, db, owner, member, now.Add(-50*time.Minute))
	unreadTopic, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(owner), ParentConversationID: unreadParent.ID, SourceMessageID: unreadSource.ID,
	})
	if err != nil {
		t.Fatalf("create unread topic: %v", err)
	}
	setTopicListState(t, db, owner.ID, unreadTopic.Conversation.ID, now.Add(-40*time.Minute), 2, 1)

	listed, err := service.List(context.Background(), ListCommand{AccountID: owner.ID})
	if err != nil {
		t.Fatalf("list grouped conversations: %v (cause: %v)", err, errors.Unwrap(err))
	}
	conversations := listed.Conversations
	if len(conversations) > 0 && conversations[0].ID == builtinAssistantConversationID(owner.ID) {
		conversations = conversations[1:]
	}
	assertConversationListPrefix(t, conversations, []string{
		activeParent.ID, firstTopic.Conversation.ID, secondTopic.Conversation.ID, recentParent.ID,
	})
	if containsConversation(conversations, staleTopic.Conversation.ID) {
		t.Fatal("read topic without activity for 30 minutes remains in the list")
	}
	unreadParentIndex := conversationListItemIndex(conversations, unreadParent.ID)
	unreadTopicIndex := conversationListItemIndex(conversations, unreadTopic.Conversation.ID)
	if unreadParentIndex < 0 || unreadTopicIndex != unreadParentIndex+1 {
		t.Fatalf("unread topic is not grouped under its parent: parent=%d topic=%d", unreadParentIndex, unreadTopicIndex)
	}
	for index := 0; index < clientConversationListLimit; index++ {
		insertPinTestConversation(t, db, owner, member, "Newer parent", now.Add(time.Duration(index)*time.Minute), now)
	}

	included, err := service.List(context.Background(), ListCommand{
		AccountID: owner.ID, IncludeConversationID: staleTopic.Conversation.ID,
	})
	if err != nil {
		t.Fatalf("list current inactive topic: %v (cause: %v)", err, errors.Unwrap(err))
	}
	staleParentIndex := conversationListItemIndex(included.Conversations, staleParent.ID)
	staleTopicIndex := conversationListItemIndex(included.Conversations, staleTopic.Conversation.ID)
	if staleParentIndex < 0 || staleTopicIndex != staleParentIndex+1 {
		t.Fatalf("current inactive topic is not grouped under its parent: parent=%d topic=%d", staleParentIndex, staleTopicIndex)
	}
}

func TestListGroupsBuiltinAssistantTopicsWithoutDuplicatingParent(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	user := insertConversationTestUser(t, db, "list-assistant-topic@example.com", "Owner", now)
	service := NewService(Dependencies{
		Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"}, DB: db,
		Now: func() time.Time { return now },
	})
	initial, err := service.List(context.Background(), ListCommand{AccountID: user.ID})
	if err != nil || len(initial.Conversations) == 0 {
		t.Fatalf("create builtin assistant conversation: %#v, err = %v", initial, err)
	}
	assistantID := builtinAssistantConversationID(user.ID)
	source := store.Message{
		ID: uuid.NewString(), ConversationID: assistantID, Seq: 1,
		SenderType: store.MessageSenderTypeUser, SenderID: &user.ID,
		Body: json.RawMessage(`{"type":"text","content":"Complex task"}`), Summary: "Complex task",
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatalf("create assistant topic source: %v", err)
	}
	if err := db.Model(&store.Conversation{}).Where("id = ?", assistantID).Updates(map[string]any{
		"last_message_at": now, "last_message_id": source.ID,
		"last_message_seq": source.Seq, "last_message_summary": source.Summary,
	}).Error; err != nil {
		t.Fatalf("update assistant conversation: %v", err)
	}
	created, err := service.CreateTopic(context.Background(), CreateTopicCommand{
		Actor: actorFromTestUser(user), ParentConversationID: assistantID, SourceMessageID: source.ID,
	})
	if err != nil {
		t.Fatalf("create assistant topic: %v", err)
	}

	listed, err := service.List(context.Background(), ListCommand{AccountID: user.ID})
	if err != nil {
		t.Fatalf("list assistant topic: %v (cause: %v)", err, errors.Unwrap(err))
	}
	assertConversationListPrefix(t, listed.Conversations, []string{assistantID, created.Conversation.ID})
	assistantCount := 0
	for _, conversation := range listed.Conversations {
		if conversation.ID == assistantID {
			assistantCount++
		}
	}
	if assistantCount != 1 {
		t.Fatalf("builtin assistant count = %d, want 1", assistantCount)
	}
}

func setTopicListState(t *testing.T, db *gorm.DB, userID, topicID string, activityAt time.Time, lastSeq, lastReadSeq int64) {
	t.Helper()
	if err := db.Model(&store.Conversation{}).Where("id = ?", topicID).Updates(map[string]any{
		"last_message_at": activityAt, "last_message_seq": lastSeq,
	}).Error; err != nil {
		t.Fatalf("update topic list state: %v", err)
	}
	if err := db.Model(&store.ConversationTopicParticipant{}).Where(
		"conversation_id = ? AND participant_type = ? AND participant_id = ?",
		topicID, store.ConversationMemberTypeUser, userID,
	).Update("last_read_seq", lastReadSeq).Error; err != nil {
		t.Fatalf("update topic read state: %v", err)
	}
}

func assertConversationListPrefix(t *testing.T, conversations []Item, want []string) {
	t.Helper()
	if len(conversations) < len(want) {
		t.Fatalf("conversation count = %d, want at least %d", len(conversations), len(want))
	}
	for index, conversationID := range want {
		if conversations[index].ID != conversationID {
			t.Fatalf("conversation %d = %s, want %s", index, conversations[index].ID, conversationID)
		}
	}
}

func conversationListItemIndex(conversations []Item, conversationID string) int {
	for index, conversation := range conversations {
		if conversation.ID == conversationID {
			return index
		}
	}
	return -1
}
