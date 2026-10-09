package conversation

import (
	"context"
	"testing"
	"time"

	"app/internal/appregistry"
	"app/internal/config"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestAssistantIsDefaultMemberInNewConversations(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "assistant-owner@example.com", "Owner", now)
	other := insertConversationTestUser(t, db, "assistant-other@example.com", "Other", now)
	app := store.App{ID: uuid.NewString(), Name: "原应用", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "secret"}
	if err := db.Create(&app).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	direct, err := service.CreateDirect(context.Background(), CreateDirectCommand{Actor: actorFromTestUser(owner), UserID: other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if direct.Conversation.MemberCount != 2 || direct.Conversation.Name != "Other" {
		t.Fatalf("direct = %#v", direct.Conversation)
	}
	group, err := service.CreateGroup(context.Background(), CreateGroupCommand{Actor: actorFromTestUser(owner), Name: "测试群", MemberIDs: []string{other.ID}, AppIDs: []string{appregistry.AIAssistantAppID}})
	if err != nil {
		t.Fatal(err)
	}
	if group.Conversation.MemberCount != 3 {
		t.Fatalf("group member count = %d, want two users and one assistant", group.Conversation.MemberCount)
	}
	appConversation, err := service.CreateApp(context.Background(), CreateAppCommand{Actor: actorFromTestUser(owner), AppID: app.ID})
	if err != nil {
		t.Fatal(err)
	}
	if appConversation.Conversation.Name != app.Name {
		t.Fatalf("app conversation = %#v, want owner app name", appConversation.Conversation)
	}
	appGroup, err := service.CreateGroupAsApplication(context.Background(), CreateGroupAsApplicationCommand{
		AppID: app.ID, Name: "应用发起的群", MemberIDs: []string{owner.ID}, AppIDs: []string{appregistry.AIAssistantAppID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if appGroup.Conversation.MemberCount != 3 {
		t.Fatalf("app-created group member count = %d, want one user and two apps", appGroup.Conversation.MemberCount)
	}
	for _, conversationID := range []string{direct.Conversation.ID, group.Conversation.ID, appConversation.Conversation.ID, appGroup.Conversation.ID} {
		var count int64
		if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL", conversationID, store.ConversationMemberTypeApp, appregistry.AIAssistantAppID).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("conversation %s assistant count = %d, err = %v", conversationID, count, err)
		}
	}
	assistantConversation, _, _, err := service.getOrCreateAccessibleAppConversation(db, owner, appregistry.AIAssistantAppID)
	if err != nil {
		t.Fatal(err)
	}
	var assistantMemberCount int64
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ? AND left_at IS NULL", assistantConversation.ID, store.ConversationMemberTypeApp).Count(&assistantMemberCount).Error; err != nil || assistantMemberCount != 1 {
		t.Fatalf("own app conversation assistant count = %d, err = %v", assistantMemberCount, err)
	}
	if err := db.Model(&store.App{}).Where("id = ?", appregistry.AIAssistantAppID).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	third := insertConversationTestUser(t, db, "assistant-third@example.com", "Third", now)
	additional, err := service.CreateDirect(context.Background(), CreateDirectCommand{Actor: actorFromTestUser(owner), UserID: third.ID})
	if err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_id = ? AND left_at IS NULL", additional.Conversation.ID, appregistry.AIAssistantAppID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("disabled assistant member count = %d, err = %v", count, err)
	}
}

func TestRemovedAppConversationKeepsOriginalIdentity(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "removed-app-owner@example.com", "Owner", now)
	app := store.App{ID: uuid.NewString(), Name: "原应用", Avatar: "/original.png", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "removed-app-secret"}
	if err := db.Create(&app).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{Apps: config.AppsConfig{AIAssistantSecret: "assistant-secret"}, DB: db, Now: func() time.Time { return now }})
	opened, err := service.CreateApp(context.Background(), CreateAppCommand{Actor: actorFromTestUser(owner), AppID: app.ID})
	if err != nil {
		t.Fatal(err)
	}
	id := opened.Conversation.ID
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ? AND member_id = ?", id, store.ConversationMemberTypeApp, app.ID).Update("left_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("app_id = ?", app.ID).Delete(&store.AppConversation{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&app).Error; err != nil {
		t.Fatal(err)
	}
	var conversation store.Conversation
	if err := db.First(&conversation, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	item, err := service.loadItem(db, conversation, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if item.Name != "原应用" || item.Avatar != "/original.png" || item.IsBuiltinAssistant || item.Pinned {
		t.Fatalf("removed app item = %#v", item)
	}
	listed, err := service.List(context.Background(), ListCommand{AccountID: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	foundRemoved, foundAssistant := false, false
	for _, entry := range listed.Conversations {
		if entry.ID == id {
			foundRemoved = true
			if entry.Name != "原应用" || entry.Avatar != "/original.png" || entry.IsBuiltinAssistant || entry.Pinned {
				t.Fatalf("removed app list entry = %#v", entry)
			}
		}
		if entry.ID == builtinAssistantConversationID(owner.ID) {
			foundAssistant = true
			if !entry.IsBuiltinAssistant || !entry.Pinned {
				t.Fatalf("assistant list entry = %#v", entry)
			}
		}
	}
	if !foundRemoved || !foundAssistant {
		t.Fatalf("missing old app or assistant: old = %v, assistant = %v", foundRemoved, foundAssistant)
	}
}

func TestAssistantCannotBeRemovedOrPromotedFromGroup(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "assistant-admin@example.com", "Owner", now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	group, err := service.CreateGroup(context.Background(), CreateGroupCommand{Actor: actorFromTestUser(owner), Name: "群"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, _, err := service.removeMember(db, owner, group.Conversation.ID, store.ConversationMemberTypeApp, appregistry.AIAssistantAppID); err != ErrAccessDenied {
		t.Fatalf("remove assistant = %v, want access denied", err)
	}
	if _, err := service.SetMemberRole(context.Background(), SetMemberRoleCommand{Actor: actorFromTestUser(owner), ConversationID: group.Conversation.ID, MemberType: store.ConversationMemberTypeApp, MemberID: appregistry.AIAssistantAppID, Role: store.ConversationMemberRoleAdmin}); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("promote assistant error = %v, want forbidden", err)
	}
}

func TestAssistantAutoJoinsNewGroupTopic(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "assistant-topic-owner@example.com", "Owner", now)
	other := insertConversationTestUser(t, db, "assistant-topic-other@example.com", "Other", now)
	parent, source := insertConversationTopicFixture(t, db, owner, other, now)
	if err := ensureAssistantMember(db, parent.ID, source.Seq+1, now); err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	created, err := service.CreateTopic(context.Background(), CreateTopicCommand{Actor: actorFromTestUser(owner), ParentConversationID: parent.ID, SourceMessageID: source.ID})
	if err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&store.ConversationTopicParticipant{}).Where("conversation_id = ? AND participant_type = ? AND participant_id = ?", created.Conversation.ID, store.ConversationMemberTypeApp, appregistry.AIAssistantAppID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("topic assistant count = %d, err = %v", count, err)
	}
}
