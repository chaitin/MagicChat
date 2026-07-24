package httpserver

import (
	"context"

	conversationapp "app/internal/application/conversation"
	"app/internal/application/groupautoname"
	"app/internal/realtime"
)

func (s *Server) PublishConversationMessage(ctx context.Context, userIDs []string, message conversationapp.Message) {
	mutedTargets := s.loadNotificationMutedTargets(ctx, message.ConversationID, userIDs)
	for _, userID := range userIDs {
		s.realtime.SendToUsers(
			[]string{userID},
			realtimeMessageCreatedEvent(
				newConversationApplicationMessageResponse(message),
				mutedTargets[userID],
			),
		)
	}
}

func (s *Server) PublishConversationMuteUpdated(_ context.Context, userIDs []string, event conversationapp.ConversationMuteEvent) {
	s.realtime.SendToUsers(userIDs, realtime.NewEvent(realtime.EventConversationMuteUpdated, conversationMuteEventResponse{
		ConversationID: event.ConversationID, Muted: event.Muted,
	}))
}

func (s *Server) PublishConversationPinUpdated(_ context.Context, userIDs []string, event conversationapp.ConversationPinEvent) {
	s.realtime.SendToUsers(userIDs, realtime.NewEvent(realtime.EventConversationPinUpdated, conversationPinEventResponse{
		ConversationID: event.ConversationID, Pinned: event.Pinned,
	}))
}

func (s *Server) PublishConversationRemoved(_ context.Context, userIDs []string, conversationID string) {
	s.realtime.SendToUsers(userIDs, realtimeConversationRemovedEvent(conversationID))
}

func (s *Server) PublishConversationRestored(_ context.Context, userIDs []string, conversationID string) {
	s.realtime.SendToUsers(userIDs, realtime.NewEvent(realtime.EventConversationRestored, conversationRestoredEventResponse{
		ConversationID: conversationID,
	}))
}

func (s *Server) PublishTopicEvent(_ context.Context, userIDs []string, event conversationapp.TopicEvent) {
	eventName := "topic." + event.Type
	switch event.Type {
	case "created":
		eventName = realtime.EventTopicCreated
	case "participated":
		eventName = realtime.EventTopicParticipated
	case "archived":
		eventName = realtime.EventTopicArchived
	}
	s.realtime.SendToUsers(userIDs, realtime.NewEvent(eventName, topicEventResponse{
		Archived: event.Archived, ConversationID: event.ConversationID,
		ParentConversationID: event.ParentConversationID, SourceMessageID: event.SourceMessageID,
	}))
}

func (s *Server) DeliverConversationAppEvents(_ context.Context, events []conversationapp.AppEvent) {
	if s.appConnections == nil {
		return
	}
	for _, event := range events {
		s.appConnections.SendToApp(event.AppID, realtime.NewCursorEvent(event.Cursor, event.Event, event.Payload))
	}
}

func (s *Server) DeliverGroupAutoNameEvents(_ context.Context, events []groupautoname.Event) {
	if s.appConnections == nil {
		return
	}
	for _, event := range events {
		s.appConnections.SendToApp(event.AppID, realtime.NewCursorEvent(event.Cursor, event.Event, event.Payload))
	}
}

type topicEventResponse struct {
	Archived             bool   `json:"archived,omitempty"`
	ConversationID       string `json:"conversation_id"`
	ParentConversationID string `json:"parent_conversation_id"`
	SourceMessageID      string `json:"source_message_id"`
}

type conversationPinEventResponse struct {
	ConversationID string `json:"conversation_id"`
	Pinned         bool   `json:"pinned"`
}

type conversationMuteEventResponse struct {
	ConversationID string `json:"conversation_id"`
	Muted          bool   `json:"muted"`
}

type conversationRestoredEventResponse struct {
	ConversationID string `json:"conversation_id"`
}

func newConversationApplicationMessageResponse(message conversationapp.Message) messageResponse {
	response := messageResponse{
		ClientMessageID: message.ClientMessageID,
		ConversationID:  message.ConversationID,
		CreatedAt:       message.CreatedAt,
		ID:              message.ID,
		Reactions:       []messageReactionResponse{},
		Sender:          messageSenderResponse{ID: message.Sender.ID, Type: message.Sender.Type},
		Seq:             message.Seq,
	}
	if message.RevokedAt == nil {
		response.Body = message.Body
	} else {
		response.RevokedAt = message.RevokedAt
		response.RevokedByUserID = message.RevokedByUserID
	}
	response.ReplyToMessageID = message.ReplyToMessageID
	if message.DelegatedBy != nil {
		response.DelegatedBy = &messageDelegatedByResponse{
			ID: message.DelegatedBy.ID, Name: message.DelegatedBy.Name, Type: message.DelegatedBy.Type,
		}
	}
	return response
}
