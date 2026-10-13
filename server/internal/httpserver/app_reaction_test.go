package httpserver

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
)

func TestThirdPartyAppSetsOwnMessageReaction(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC()
	user := insertTestUser(t, db, "app-reaction@example.com", "User", store.UserStatusActive, now)
	app := insertTestApp(t, db, store.App{Name: "Receipt App", Enabled: true, Visibility: store.AppVisibilityPublic, ConnectionSecret: "receipt-secret", CreatedAt: now, UpdatedAt: now})
	conversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: user.ID, kind: store.ConversationKindGroup, memberIDs: []string{user.ID}, name: "Group", now: now,
	})
	insertTestAppConversationMember(t, db, app.ID, conversation.ID, now)
	message := store.Message{ID: uuid.NewString(), ConversationID: conversation.ID, Seq: 1, SenderType: "user", SenderID: &user.ID,
		Body: json.RawMessage(`{"type":"text","content":"hello"}`), Summary: "hello", CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	cookie := loginAsUser(t, server, user.Email)
	clientConn := dialClientWebSocket(t, server, cookie)
	if event := readRealtimeEvent(t, clientConn); event.Event != realtime.EventSystemReady {
		t.Fatalf("ready event = %#v", event)
	}
	conn := dialAppWebSocket(t, server, app.ID, app.ConnectionSecret)
	request := func(payload map[string]any) realtime.Envelope {
		return sendRawAppRequest(t, conn, realtime.Envelope{
			V: realtime.ProtocolVersion, Kind: realtime.KindRequest, ID: uuid.NewString(), Method: appMethodMessageReactionSet,
			Payload: mustMarshalPayloadForTest(t, payload),
		})
	}
	payload := map[string]any{"conversation_id": conversation.ID, "message_id": message.ID, "text": "收到", "reacted": true, "app_id": uuid.NewString(), "actor_user_id": user.ID}
	for i := 0; i < 2; i++ {
		response := request(payload)
		if response.Error != nil {
			t.Fatalf("reaction response = %#v", response)
		}
		var result appSetMessageReactionResponse
		if err := json.Unmarshal(response.Payload, &result); err != nil {
			t.Fatal(err)
		}
		if result.ReactionVersion != 1 || len(result.Reactions) != 1 || result.Reactions[0].Count != 1 || !result.Reactions[0].ReactedByMe ||
			len(result.Reactions[0].Users) != 1 || result.Reactions[0].Users[0].ID != app.ID || result.Reactions[0].Users[0].Type != "app" {
			t.Fatalf("result = %#v", result)
		}
	}
	if err := clientConn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		event := readRealtimeEvent(t, clientConn)
		if event.Event != realtime.EventMessageReactionsUpdated {
			continue
		}
		var update messageReactionsUpdatedEventPayload
		if err := json.Unmarshal(event.Payload, &update); err != nil {
			t.Fatal(err)
		}
		if update.ActorAppID != app.ID || update.ActorUserID != "" || update.MessageID != message.ID || update.ReactionVersion != 1 ||
			len(update.Reactions) != 1 || update.Reactions[0].Users[0].Type != "app" {
			t.Fatalf("user reaction event = %#v", update)
		}
		break
	}
	status, body := postJSON(t, server, "/api/client/conversations/"+conversation.ID+"/messages/reactions/query", map[string]any{"message_ids": []string{message.ID}}, cookie)
	if status.StatusCode != http.StatusOK {
		t.Fatalf("snapshot status = %d, body = %#v", status.StatusCode, body)
	}
	snapshots := requireSuccess(t, body)["snapshots"].([]any)
	reaction := snapshots[0].(map[string]any)["reactions"].([]any)[0].(map[string]any)
	participant := reaction["users"].([]any)[0].(map[string]any)
	if reaction["reacted_by_me"] != false || participant["type"] != "app" || participant["id"] != app.ID || participant["name"] != app.Name {
		t.Fatalf("native snapshot = %#v", reaction)
	}
	delete(payload, "reacted")
	requireAppErrorResponse(t, request(payload), "invalid_request")
	payload["reacted"] = true
	payload["text"] = "bad\ntext"
	requireAppErrorResponse(t, request(payload), "invalid_request")
	payload["text"] = "收到"
	payload["message_id"] = uuid.NewString()
	requireAppErrorResponse(t, request(payload), "not_found")
	payload["message_id"] = message.ID
	payload["reacted"] = false
	response := request(payload)
	var removed appSetMessageReactionResponse
	if err := json.Unmarshal(response.Payload, &removed); err != nil || response.Error != nil || removed.ReactionVersion != 2 || len(removed.Reactions) != 0 {
		t.Fatalf("removed = %#v, error = %v, response = %#v", removed, err, response)
	}
	if err := db.Model(&store.ConversationMember{}).Where("conversation_id = ? AND member_type = ?", conversation.ID, "app").Update("left_at", now).Error; err != nil {
		t.Fatal(err)
	}
	payload["reacted"] = true
	requireAppErrorResponse(t, request(payload), "forbidden")
}
