package appclient

import (
	"context"
	"log"
	"strings"
	"time"
)

const messageReceiptTimeout = 3 * time.Second

func notifyMessageReceived(onReceived func(messageCreatedPayload), appID string, payload messageCreatedPayload) {
	if onReceived == nil || strings.EqualFold(strings.TrimSpace(payload.Sender.Type), "system") {
		return
	}
	if strings.EqualFold(strings.TrimSpace(payload.Sender.Type), "app") && strings.EqualFold(payload.Sender.ID, appID) {
		return
	}
	onReceived(payload)
}

type setMessageReactionPayload struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
	Text           string `json:"text"`
	Reacted        bool   `json:"reacted"`
}

type messageReceiptSender struct {
	queue  chan setMessageReactionPayload
	cancel context.CancelFunc
	done   chan struct{}
}

func newMessageReceiptSender(ctx context.Context, requester appRequester, appID string) *messageReceiptSender {
	ctx, cancel := context.WithCancel(ctx)
	sender := &messageReceiptSender{
		queue: make(chan setMessageReactionPayload, maxQueuedAppEvents), cancel: cancel, done: make(chan struct{}),
	}
	go func() {
		defer close(sender.done)
		for {
			select {
			case <-ctx.Done():
				return
			case payload := <-sender.queue:
				if ctx.Err() != nil {
					return
				}
				log.Printf("send message receipt: app_id=%s conversation_id=%s message_id=%s text=%q", appID, payload.ConversationID, payload.MessageID, payload.Text)
				requestCtx, cancelRequest := context.WithTimeout(ctx, messageReceiptTimeout)
				_, err := requester.Request(requestCtx, methodMessageReactionSet, payload)
				cancelRequest()
				if err != nil && ctx.Err() == nil {
					log.Printf("send message receipt failed: app_id=%s conversation_id=%s message_id=%s error=%v", appID, payload.ConversationID, payload.MessageID, err)
				} else if err == nil {
					log.Printf("message receipt sent: app_id=%s conversation_id=%s message_id=%s text=%q", appID, payload.ConversationID, payload.MessageID, payload.Text)
				}
			}
		}
	}()
	return sender
}

// Submit never waits for the socket or a response, including when the queue is full.
func (s *messageReceiptSender) Submit(payload messageCreatedPayload) {
	if s == nil || strings.TrimSpace(payload.Conversation.ID) == "" || strings.TrimSpace(payload.Message.ID) == "" {
		return
	}
	receipt := setMessageReactionPayload{
		ConversationID: payload.Conversation.ID, MessageID: payload.Message.ID, Text: "👀", Reacted: true,
	}
	select {
	case <-s.done:
		return
	case s.queue <- receipt:
		log.Printf("message receipt queued: conversation_id=%s message_id=%s text=%q", receipt.ConversationID, receipt.MessageID, receipt.Text)
	default:
		log.Printf("skip message receipt: queue full conversation_id=%s message_id=%s", receipt.ConversationID, receipt.MessageID)
	}
}

func (s *messageReceiptSender) Close() {
	if s != nil {
		s.cancel()
		<-s.done
	}
}
