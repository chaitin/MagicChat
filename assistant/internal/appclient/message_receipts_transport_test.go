package appclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"assistant/internal/agent"
	"assistant/internal/config"

	"github.com/gorilla/websocket"
)

func TestMessageReceiptDoesNotBlockEventAckWithoutResponse(t *testing.T) {
	receipts := make(chan setMessageReactionPayload, 1)
	acks := make(chan int64, 1)
	serverErrors := make(chan error, 1)
	message := testMessageCreatedEnvelope(t, "user-1", "message-1", 1, "hello")
	message.Cursor = 42
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			serverErrors <- err
			return
		}
		defer conn.Close()
		if err := conn.WriteJSON(message); err != nil {
			serverErrors <- err
			return
		}
		for {
			var request envelope
			if err := conn.ReadJSON(&request); err != nil {
				return
			}
			payload := json.RawMessage(`{}`)
			switch request.Method {
			case methodMessageReactionSet:
				var receipt setMessageReactionPayload
				if err := json.Unmarshal(request.Payload, &receipt); err != nil {
					serverErrors <- err
					return
				}
				receipts <- receipt
				// Deliberately leave the receipt request unanswered.
				continue
			case methodConversationMessagesList:
				payload = json.RawMessage(`{"messages":[]}`)
			case methodEventsAck:
				var ack struct {
					Cursor int64 `json:"cursor"`
				}
				if err := json.Unmarshal(request.Payload, &ack); err != nil {
					serverErrors <- err
					return
				}
				acks <- ack.Cursor
			}
			ok := true
			if err := conn.WriteJSON(envelope{V: protocolVersion, Kind: kindResponse, ReplyTo: request.ID, OK: &ok, Payload: payload}); err != nil {
				serverErrors <- err
				return
			}
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cfg := config.Config{AppID: "assistant", WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http")}
	transport := newWebSocketManager(cfg, webSocketManagerOptions{})
	client := &Client{
		cfg: cfg, transport: transport, requester: newReliableRequester(transport, reliableRequesterOptions{}),
		runner:         newConversationAgentRunner(ctx),
		assistantAgent: replyAgentFunc(func(context.Context, agent.Request, agent.OutputSink) error { return nil }),
	}
	defer client.Close()
	done := make(chan error, 1)
	go func() { done <- client.Run(ctx) }()
	select {
	case cursor := <-acks:
		if cursor != 42 {
			t.Fatalf("ack cursor = %d, want 42", cursor)
		}
	case err := <-serverErrors:
		t.Fatal(err)
	case <-time.After(time.Second):
		t.Fatal("unanswered receipt blocked event ACK")
	}
	select {
	case receipt := <-receipts:
		if receipt.ConversationID != "conversation-1" || receipt.MessageID != "message-1" || receipt.Text != "👀" || !receipt.Reacted {
			t.Fatalf("receipt = %#v", receipt)
		}
	case <-time.After(time.Second):
		t.Fatal("receipt was not submitted")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not stop")
	}
}
