package message

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
)

func TestAuthorizeRunAsTriggerRejectsRevokedDeletedInactiveAndMismatchedTriggers(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	service := NewService(Dependencies{DB: db})
	now := time.Now().UTC()
	newTrigger := func(seq int64) store.Message {
		t.Helper()
		clientMessageID := uuid.NewString()
		message := store.Message{
			ID: uuid.NewString(), ConversationID: fixture.conversation.ID, Seq: seq,
			SenderType: store.MessageSenderTypeUser, SenderID: &fixture.user.ID,
			ClientMessageID: &clientMessageID, Body: json.RawMessage(`{"type":"text","content":"rename"}`),
			Summary: "rename", CreatedAt: now, UpdatedAt: now,
		}
		if err := db.Create(&message).Error; err != nil {
			t.Fatalf("create trigger: %v", err)
		}
		return message
	}
	authorize := func(triggerID, authorizationConversationID string) error {
		return service.AuthorizeRunAsTrigger(context.Background(), RunAsTriggerCommand{
			ActorID: fixture.user.ID, ActorType: store.MessageSenderTypeUser, AppID: fixture.app.ID,
			AuthorizationConversationID: authorizationConversationID, TriggerMessageID: triggerID,
		})
	}

	valid := newTrigger(1)
	if err := authorize(valid.ID, fixture.conversation.ID); err != nil {
		t.Fatalf("authorize valid trigger: %v", err)
	}
	if err := authorize(valid.ID, uuid.NewString()); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("mismatched authorization conversation error = %v, want forbidden", err)
	}

	revoked := newTrigger(2)
	if err := db.Model(&store.Message{}).Where("id = ?", revoked.ID).
		Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
		t.Fatalf("revoke trigger: %v", err)
	}
	if err := authorize(revoked.ID, fixture.conversation.ID); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("revoked trigger error = %v, want forbidden", err)
	}

	deleted := newTrigger(3)
	if err := db.Model(&store.Message{}).Where("id = ?", deleted.ID).
		Updates(map[string]any{"deleted_at": now, "updated_at": now}).Error; err != nil {
		t.Fatalf("delete trigger: %v", err)
	}
	if err := authorize(deleted.ID, fixture.conversation.ID); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("deleted trigger error = %v, want forbidden", err)
	}

	if err := db.Model(&store.User{}).Where("id = ?", fixture.user.ID).
		Update("status", store.UserStatusDisabled).Error; err != nil {
		t.Fatalf("disable trigger user: %v", err)
	}
	if err := authorize(valid.ID, fixture.conversation.ID); ErrorCodeOf(err) != CodeForbidden {
		t.Fatalf("inactive user trigger error = %v, want forbidden", err)
	}
}
