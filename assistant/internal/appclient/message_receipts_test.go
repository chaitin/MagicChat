package appclient

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"assistant/internal/agent"
)

func TestMessageReceiptSenderUsesFixedTextAndContinuesAfterFailure(t *testing.T) {
	calls := make(chan setMessageReactionPayload, 2)
	requester := appRequestFunc(func(ctx context.Context, method string, value any) (json.RawMessage, error) {
		payload := value.(setMessageReactionPayload)
		if method != methodMessageReactionSet {
			return nil, errors.New("unexpected method")
		}
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > messageReceiptTimeout {
			return nil, errors.New("missing short deadline")
		}
		calls <- payload
		return nil, errors.New("receipt unavailable")
	})
	sender := newMessageReceiptSender(context.Background(), requester, "assistant")
	defer sender.Close()
	for _, id := range []string{"message-1", "message-2"} {
		sender.Submit(messageCreatedPayload{Conversation: conversationPayload{ID: "conversation"}, Message: messagePayload{ID: id}})
	}
	for _, id := range []string{"message-1", "message-2"} {
		select {
		case payload := <-calls:
			if payload.ConversationID != "conversation" || payload.MessageID != id || payload.Text != "👀" || !payload.Reacted {
				t.Fatalf("receipt = %#v", payload)
			}
		case <-time.After(time.Second):
			t.Fatal("receipt was not sent")
		}
	}
}

func TestMessageReceiptDoesNotBlockMessageProcessing(t *testing.T) {
	started := make(chan struct{})
	sender := newMessageReceiptSender(context.Background(), appRequestFunc(func(ctx context.Context, _ string, _ any) (json.RawMessage, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}), "assistant")
	defer sender.Close()
	done := make(chan bool, 1)
	message := testMessageCreatedEnvelope(t, "user-1", "message-1", 1, "hello")
	go func() {
		done <- handleParsedServerMessageWithTopicRouter(context.Background(), message, "assistant",
			appRequestFunc(func(context.Context, string, any) (json.RawMessage, error) {
				return json.RawMessage(`{"messages":[]}`), nil
			}),
			replyAgentFunc(func(context.Context, agent.Request, agent.OutputSink) error { return nil }),
			nil, directAgentRunner{}, sender.Submit, func(context.Context, envelope) error { return nil })
	}()
	select {
	case handled := <-done:
		if !handled {
			t.Fatal("normal message was not handled")
		}
	case <-time.After(time.Second):
		t.Fatal("receipt blocked normal processing")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("receipt did not start")
	}
}

type receiptClaimRunner struct{ directAgentRunner }

func (receiptClaimRunner) ClaimIncomingConversationMessage(string, int64, string, string) bool {
	return true
}

func TestMessageReceiptCoversClaimedRepliesAndIgnoresUnrelatedMessages(t *testing.T) {
	appID := "00000000-0000-0000-0000-000000000001"
	for _, test := range []struct {
		name    string
		message envelope
		runner  agentRunner
		want    int
	}{
		{"waiting reply", testMessageCreatedEnvelope(t, "user-1", "message-1", 1, "reply"), receiptClaimRunner{}, 1},
		{"unmentioned group", testGroupMessageCreatedEnvelope(t, appID, "user-1", "message-2", 2, "hello"), directAgentRunner{}, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			count := 0
			handled := handleParsedServerMessageWithTopicRouter(context.Background(), test.message, appID, nil, nil, nil, test.runner,
				func(payload messageCreatedPayload) { count++ }, nil)
			if !handled || count != test.want {
				t.Fatalf("handled = %t, receipts = %d, want %d", handled, count, test.want)
			}
		})
	}
	count := 0
	notifyMessageReceived(func(messageCreatedPayload) { count++ }, appID, messageCreatedPayload{Sender: senderPayload{ID: appID, Type: "app"}})
	if count != 0 {
		t.Fatal("assistant acknowledged its own message")
	}
}

func TestMessageReceiptFullQueueDoesNotBlock(t *testing.T) {
	sender := &messageReceiptSender{queue: make(chan setMessageReactionPayload, 1), done: make(chan struct{})}
	payload := messageCreatedPayload{Conversation: conversationPayload{ID: "conversation"}, Message: messagePayload{ID: "message"}}
	done := make(chan struct{})
	go func() {
		sender.Submit(payload)
		sender.Submit(payload)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("full queue blocked message receipt submission")
	}
}
