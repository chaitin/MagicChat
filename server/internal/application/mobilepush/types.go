package mobilepush

import (
	"context"
	"time"
)

const GatewayURL = "https://push.jiying.chat"

const (
	GrantStatusActive   = "active"
	GrantStatusDisabled = "disabled"

	EventStatusQueued    = "queued"
	EventStatusExpanding = "expanding"
	EventStatusRetry     = "retry"
	EventStatusExpired   = "expired"

	JobStatusQueued     = "queued"
	JobStatusSending    = "sending"
	JobStatusRetry      = "retry"
	JobStatusSent       = "sent"
	JobStatusFailed     = "failed"
	JobStatusExpired    = "expired"
	JobStatusSuppressed = "suppressed"
)

type RegisterGrantCommand struct {
	UserID         string
	SessionID      string
	InstallationID string
	GatewayGrantID string
	SendToken      string
	Platform       string
	ExpiresAt      time.Time
}

type Grant struct {
	InstallationID string
	GatewayGrantID string
	Platform       string
	ExpiresAt      time.Time
}

type Route struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
}

type NotificationRequest struct {
	Event       string `json:"event"`
	RouteToken  string `json:"route_token"`
	CollapseKey string `json:"collapse_key,omitempty"`
	TTLSeconds  int    `json:"ttl_seconds"`
}

type GatewayErrorKind string

const (
	GatewayErrorRetry   GatewayErrorKind = "retry"
	GatewayErrorRevoked GatewayErrorKind = "revoked"
	GatewayErrorInvalid GatewayErrorKind = "invalid"
)

type GatewayError struct {
	Kind       GatewayErrorKind
	Code       string
	StatusCode int
	Err        error
}

func (e *GatewayError) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func (e *GatewayError) Unwrap() error { return e.Err }

type GatewayClient interface {
	Send(context.Context, string, string, string, NotificationRequest) error
}

type PushPreferences struct {
	PauseWhenDesktopActive bool `json:"pause_when_desktop_active"`
}

type PresenceCommand struct {
	UserID     string
	SessionID  string
	Platform   string
	Foreground bool
}

type PushJobStatus struct {
	Status    string    `json:"status"`
	Reason    string    `json:"reason"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PushStatus struct {
	Enabled       bool           `json:"enabled"`
	Registered    bool           `json:"registered"`
	Foreground    bool           `json:"foreground"`
	DesktopActive bool           `json:"desktop_active"`
	DelaySeconds  int            `json:"delay_seconds"`
	LastJob       *PushJobStatus `json:"last_job"`
}

type ClientService interface {
	RegisterGrant(context.Context, RegisterGrantCommand) (Grant, error)
	RevokeGrant(context.Context, string, string, string) error
	ResolveRoute(context.Context, string, string) (Route, error)
	ReportPresence(context.Context, PresenceCommand) error
	GetPreferences(context.Context, string) (PushPreferences, error)
	SetPreferences(context.Context, string, PushPreferences) (PushPreferences, error)
	GetStatus(context.Context, string, string) (PushStatus, error)
}
