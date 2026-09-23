package conversation

import (
	"context"
	"encoding/json"
	"sync"

	projectapp "app/internal/application/project"
)

type ProjectReader interface {
	ListForConversations(context.Context, []string) (map[string][]projectapp.ConversationProject, error)
}

type NotificationPort interface {
	PublishConversationMessage(context.Context, []string, Message)
	PublishConversationMuteUpdated(context.Context, []string, ConversationMuteEvent)
	PublishConversationPinUpdated(context.Context, []string, ConversationPinEvent)
	PublishConversationReadUpdated(context.Context, []string, ReadResult)
	PublishConversationRemoved(context.Context, []string, string)
	PublishConversationRestored(context.Context, []string, string)
	PublishTopicEvent(context.Context, []string, TopicEvent)
}

type AppEvent struct {
	AppID   string
	Cursor  int64
	Event   string
	Payload json.RawMessage
}

type AppEventPort interface {
	DeliverConversationAppEvents(context.Context, []AppEvent)
}

type AppEventLocker interface {
	sync.Locker
}
