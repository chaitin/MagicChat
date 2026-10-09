package message

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/appregistry"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestAssistantMentionInOtherAppConversationRoutesToAssistantOnly(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	now := time.Now().UTC()
	assistant := store.App{ID: appregistry.AIAssistantAppID, Name: "自定义名称", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "assistant-secret"}
	if err := db.Create(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&store.ConversationMember{ConversationID: fixture.conversation.ID, MemberType: store.ConversationMemberTypeApp, MemberID: assistant.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now, HistoryVisibleFromSeq: 1}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db, Bodies: fixedMessageBodyProcessor{}})
	for index, test := range []struct {
		content string
		wantID  string
	}{
		{content: "普通消息", wantID: fixture.app.ID},
		{content: "请处理 {(@app/" + assistant.ID + ")}", wantID: assistant.ID},
	} {
		body, _ := json.Marshal(map[string]string{"type": "text", "content": test.content})
		result, err := service.Create(context.Background(), CreateCommand{AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, ClientMessageID: uuid.NewString(), Body: body})
		if err != nil {
			t.Fatal(err)
		}
		var events []store.AppEventOutbox
		if err := db.Where("payload LIKE ?", "%"+result.Message.ID+"%").Find(&events).Error; err != nil {
			t.Fatal(err)
		}
		if len(events) != 1 || events[0].AppID != test.wantID {
			t.Fatalf("message %d events = %#v, want only %s", index, events, test.wantID)
		}
	}
	body := json.RawMessage(`{"type":"text","content":"回复"}`)
	if _, err := service.CreateAsApp(context.Background(), CreateAsAppCommand{
		AppID: assistant.ID, ConversationID: fixture.conversation.ID, ClientMessageID: uuid.NewString(), Body: body,
		Finalize: func(_ context.Context, value json.RawMessage) (json.RawMessage, string, error) {
			return value, "回复", nil
		},
	}); err != nil {
		t.Fatalf("assistant reply in another app conversation: %v", err)
	}
}

func TestAssistantDirectConversationRequiresMentionAndEnabledApp(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	assistant := store.App{ID: appregistry.AIAssistantAppID, Name: "自定义名称", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "assistant-secret"}
	if err := db.Create(&assistant).Error; err != nil {
		t.Fatal(err)
	}
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindDirect, CreatedByUserID: fixture.user.ID, Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	for _, member := range []store.ConversationMember{
		{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: fixture.user.ID, Role: store.ConversationMemberRoleOwner, JoinedAt: time.Now().UTC(), HistoryVisibleFromSeq: 1},
		{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeApp, MemberID: assistant.ID, Role: store.ConversationMemberRoleMember, JoinedAt: time.Now().UTC(), HistoryVisibleFromSeq: 1},
	} {
		if err := db.Create(&member).Error; err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(Dependencies{DB: db, Bodies: fixedMessageBodyProcessor{}})
	for index, test := range []struct {
		content string
		want    int64
	}{
		{content: "@茉莉 普通文字", want: 0},
		{content: "请处理 {(@app/" + assistant.ID + ")}", want: 1},
	} {
		body, _ := json.Marshal(map[string]string{"type": "text", "content": test.content})
		_, err := service.Create(context.Background(), CreateCommand{AccountID: fixture.user.ID, ConversationID: conversation.ID, ClientMessageID: uuid.NewString(), Body: body})
		if err != nil {
			t.Fatal(err)
		}
		var count int64
		if err := db.Model(&store.AppEventOutbox{}).Where("app_id = ?", assistant.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != test.want {
			t.Fatalf("step %d outbox count = %d, want %d", index, count, test.want)
		}
	}
	if err := db.Model(&assistant).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"type": "text", "content": "{(@app/" + assistant.ID + ")}"})
	if _, err := service.Create(context.Background(), CreateCommand{AccountID: fixture.user.ID, ConversationID: conversation.ID, ClientMessageID: uuid.NewString(), Body: body}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&store.AppEventOutbox{}).Where("app_id = ?", assistant.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("disabled assistant outbox count = %d, error %v", count, err)
	}
}
