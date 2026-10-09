package httpserver

import (
	"encoding/json"
	"testing"
	"time"

	"app/internal/appregistry"
	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestBuiltinAssistantCanReplyInPrivateAndOtherAppConversations(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	alice := insertTestUser(t, db, "assistant-private-reply-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "assistant-private-reply-bob@example.com", "Bob", store.UserStatusActive, now)
	ownerApp := insertTestApp(t, db, store.App{ID: uuid.NewString(), Name: "Other app", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "other-app-reply-secret", CreatedAt: now, UpdatedAt: now})
	private := insertTestConversation(t, db, testConversationInput{createdByUserID: alice.ID, kind: store.ConversationKindDirect, memberIDs: []string{alice.ID, bob.ID}, now: now})
	insertTestAppConversationMember(t, db, appregistry.AIAssistantAppID, private.ID, now)
	insertTestAppConversationMember(t, db, ownerApp.ID, private.ID, now)
	otherAppConversation := insertTestConversation(t, db, testConversationInput{createdByUserID: alice.ID, kind: store.ConversationKindApp, memberIDs: []string{alice.ID}, now: now})
	insertTestAppConversationLink(t, db, ownerApp.ID, alice.ID, otherAppConversation.ID, now)
	insertTestAppConversationMember(t, db, appregistry.AIAssistantAppID, otherAppConversation.ID, now)

	assistantConn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
	for _, conversation := range []store.Conversation{private, otherAppConversation} {
		response := sendAppRequest(t, assistantConn, realtime.Envelope{
			V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: uuid.NewString(), Method: appMethodMessageSend,
			Payload: mustMarshalPayloadForTest(t, map[string]any{
				"target":  map[string]any{"type": map[string]string{store.ConversationKindDirect: "conversation", store.ConversationKindApp: "app"}[conversation.Kind], "conversation_id": conversation.ID},
				"message": map[string]any{"type": "text", "content": "在的"},
			}),
		})
		var sent appSendMessageResponse
		if err := json.Unmarshal(response.Payload, &sent); err != nil || sent.Conversation.ID != conversation.ID || sent.Message.Summary != "在的" {
			t.Fatalf("assistant reply in %s = %#v, err = %v", conversation.Kind, sent, err)
		}
		var message store.Message
		if err := db.First(&message, "conversation_id = ? AND sender_type = ? AND sender_id = ?", conversation.ID, store.MessageSenderTypeApp, appregistry.AIAssistantAppID).Error; err != nil {
			t.Fatalf("persist assistant reply in %s: %v", conversation.Kind, err)
		}
	}

	carol := insertTestUser(t, db, "assistant-private-reply-carol@example.com", "Carol", store.UserStatusActive, now)
	withoutAssistant := insertTestConversation(t, db, testConversationInput{createdByUserID: alice.ID, kind: store.ConversationKindDirect, memberIDs: []string{alice.ID, carol.ID}, now: now})
	missingMemberReply := sendRawAppRequest(t, assistantConn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: uuid.NewString(), Method: appMethodMessageSend,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"target":  map[string]any{"type": "conversation", "conversation_id": withoutAssistant.ID},
			"message": map[string]any{"type": "text", "content": "unauthorized"},
		}),
	})
	if missingMemberReply.Error == nil || missingMemberReply.Error.Code != "forbidden" {
		t.Fatalf("assistant nonmember private reply = %#v, want forbidden", missingMemberReply)
	}

	otherConn := dialAppWebSocket(t, server, ownerApp.ID, ownerApp.ConnectionSecret)
	response := sendRawAppRequest(t, otherConn, realtime.Envelope{
		V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: uuid.NewString(), Method: appMethodMessageSend,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"target":  map[string]any{"type": "conversation", "conversation_id": private.ID},
			"message": map[string]any{"type": "text", "content": "unauthorized"},
		}),
	})
	if response.Error == nil || response.Error.Code != "forbidden" {
		t.Fatalf("ordinary app private reply = %#v, want forbidden", response)
	}
}
