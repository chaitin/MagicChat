package httpserver

import (
	"context"
	"time"

	"app/internal/realtime"
)

const (
	userPresenceUpdatedEvent = "user.presence.updated"
	userProfileUpdatedEvent  = "user.profile.updated"
)

type userProfileUpdatedEventResponse struct {
	UserID    string    `json:"user_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

type userPresenceUpdatedEventResponse struct {
	UserID       string     `json:"user_id"`
	Online       bool       `json:"online"`
	LastOnlineAt *time.Time `json:"last_online_at,omitempty"`
}

func (s *Server) PublishUserProfileUpdated(_ context.Context, userID string, updatedAt time.Time) {
	if s.accounts != nil {
		s.accounts.InvalidateProfile(userID)
	}
	s.realtime.Broadcast(realtime.NewEvent(userProfileUpdatedEvent, userProfileUpdatedEventResponse{
		UserID: userID, UpdatedAt: updatedAt,
	}))
}

func (s *Server) publishUserPresenceUpdated(userID string, online bool, lastOnlineAt *time.Time) {
	s.realtime.BroadcastExceptUser(userID, realtime.NewEvent(userPresenceUpdatedEvent, userPresenceUpdatedEventResponse{
		UserID: userID, Online: online, LastOnlineAt: lastOnlineAt,
	}))
}
