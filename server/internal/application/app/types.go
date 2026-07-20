package app

import (
	"context"
	"io"
	"time"
)

const (
	ConnectionStatusDisabled = "disabled"
	ConnectionStatusOffline  = "offline"
	ConnectionStatusOnline   = "online"

	VisibilityCreator    = "creator"
	VisibilityRestricted = "restricted"
	VisibilityPublic     = "public"

	MaxAvatarBytes         = 1 * 1024 * 1024
	MaxDescriptionLength   = 2000
	MaxOwnedAppsPerAccount = 20
)

type App struct {
	Avatar           string
	ConnectionSecret string
	ConnectionStatus string
	CreatedAt        time.Time
	Creator          *Creator
	CreatorUserID    *string
	Description      string
	Enabled          bool
	ID               string
	Name             string
	System           bool
	UpdatedAt        time.Time
	Visibility       string
	GrantedUserIDs   []string
}

type Creator struct {
	Avatar   string
	Email    string
	ID       string
	Name     string
	Nickname string
}

type OwnedAppCommand struct {
	AccountID string
	AppID     string
}

type CreateOwnedCommand struct {
	AccountID   string
	Description string
	Name        string
	Visibility  string
	UserIDs     []string
}

type UpdateOwnedCommand struct {
	AccountID   string
	AppID       string
	Description *string
	Name        *string
	Visibility  *string
	UserIDs     *[]string
}

type SetOwnedEnabledCommand struct {
	AccountID string
	AppID     string
	Enabled   bool
}

type UploadOwnedAvatarCommand struct {
	AccountID string
	AppID     string
	Content   io.Reader
	Size      int64
}

type CreateCommand struct {
	Description string
	Name        string
	Visibility  string
}

type UpdateCommand struct {
	AppID       string
	Description string
	Name        string
	Visibility  string
}

type SetEnabledCommand struct {
	AppID   string
	Enabled bool
}

type UploadAvatarCommand struct {
	AppID   string
	Content io.Reader
	Size    int64
}

type AdminService interface {
	List(context.Context) ([]App, error)
	Get(context.Context, string) (App, error)
	Create(context.Context, CreateCommand) (App, error)
	Update(context.Context, UpdateCommand) (App, error)
	SetEnabled(context.Context, SetEnabledCommand) (App, error)
	RegenerateSecret(context.Context, string) (App, error)
	Delete(context.Context, string) error
	UploadAvatar(context.Context, UploadAvatarCommand) (App, error)
}

type ConnectionService interface {
	GetForConnection(context.Context, string) (App, error)
	CanUserAccess(context.Context, string, string) (bool, error)
}

type ClientService interface {
	ListOwned(context.Context, string) ([]App, error)
	GetOwned(context.Context, OwnedAppCommand) (App, error)
	CreateOwned(context.Context, CreateOwnedCommand) (App, error)
	UpdateOwned(context.Context, UpdateOwnedCommand) (App, error)
	SetOwnedEnabled(context.Context, SetOwnedEnabledCommand) (App, error)
	RegenerateOwnedSecret(context.Context, OwnedAppCommand) (App, error)
	DeleteOwned(context.Context, OwnedAppCommand) error
	UploadOwnedAvatar(context.Context, UploadOwnedAvatarCommand) (App, error)
}
