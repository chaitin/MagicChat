package httpserver

import (
	"context"
	"time"

	"app/internal/realtime"
)

const (
	contactDirectoryModeUpdatedEvent = "contact.directory.mode.updated"
	organizationUpdatedEvent         = "organization.updated"
	userNicknamePolicyUpdatedEvent   = "user.nickname.policy.updated"
)

type contactDirectoryModeUpdatedEventResponse struct {
	Mode string `json:"mode"`
}

type userNicknamePolicyUpdatedEventResponse struct {
	AllowUserNicknameEditing bool      `json:"allow_user_nickname_editing"`
	UpdatedAt                time.Time `json:"updated_at"`
}

func (s *Server) PublishContactDirectoryModeUpdated(_ context.Context, mode string) {
	s.realtime.Broadcast(realtime.NewEvent(contactDirectoryModeUpdatedEvent, contactDirectoryModeUpdatedEventResponse{Mode: mode}))
}

func (s *Server) publishOrganizationUpdated() {
	s.realtime.Broadcast(realtime.NewEvent(organizationUpdatedEvent, struct{}{}))
}

func (s *Server) PublishOrganizationUpdated(_ context.Context) {
	s.publishOrganizationUpdated()
}

func (s *Server) PublishUserNicknamePolicyUpdated(_ context.Context, allowUserNicknameEditing bool, updatedAt time.Time) {
	if s.appConnections != nil {
		s.appConnections.CloseAll()
	}
	s.realtime.Broadcast(realtime.NewEvent(userNicknamePolicyUpdatedEvent, userNicknamePolicyUpdatedEventResponse{
		AllowUserNicknameEditing: allowUserNicknameEditing,
		UpdatedAt:                updatedAt,
	}))
}
