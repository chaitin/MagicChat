package contact

import (
	"context"
	"time"

	"gorm.io/gorm"
)

const (
	IdentityTypeUser = "user"
	IdentityTypeApp  = "app"

	ContactTypeUser  = "user"
	ContactTypeApp   = "app"
	ContactTypeGroup = "group"

	DirectoryModeOrganization = "organization"
	DirectoryModeFriends      = "friends"

	FriendRequestDirectionIncoming = "incoming"
	FriendRequestDirectionOutgoing = "outgoing"
)

type Identity struct {
	ID   string
	Type string
}

type User struct {
	Avatar       string
	Email        string
	ID           string
	LastOnlineAt *time.Time
	Name         string
	Nickname     string
	Online       bool
	Phone        string
	Type         string
	UpdatedAt    time.Time
}

type App struct {
	Avatar        string
	CreatorUserID *string
	Description   string
	ID            string
	Name          string
	Online        bool
	Type          string
}

type GroupAvatarMember struct {
	Avatar   string
	ID       string
	Name     string
	Nickname string
	Role     string
	Type     string
}

type Group struct {
	Avatar        string
	AvatarMembers []GroupAvatarMember
	ID            string
	Joined        bool
	MemberCount   int
	Name          string
	Type          string
	Visibility    string
}

type ListCommand struct {
	AccountID string
	Keyword   string
}

type ListResult struct {
	Apps          []App
	DirectoryMode string
	Groups        []Group
	Users         []User
}

type ListUsersCommand struct {
	AccountID string
	Keyword   string
}

type ListUsersResult struct {
	Users []User
}

type ResolveUsersCommand struct {
	AccountID string
	UserIDs   []string
}

type ResolveUsersResult struct {
	Users []User
}

type FriendRequest struct {
	ID              string
	RequesterUserID string
	AddresseeUserID string
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	HandledAt       *time.Time
}

type ListFriendRequestsCommand struct {
	AccountID string
	Direction string
}

type ListFriendRequestsResult struct {
	Requests []FriendRequest
}

type CreateFriendRequestCommand struct {
	AccountID string
	UserID    string
}

type UpdateFriendRequestCommand struct {
	AccountID string
	RequestID string
}

type DeleteFriendCommand struct {
	AccountID string
	UserID    string
}

type SearchUsersCommand struct {
	AccountID string
	Query     string
}

type SearchUsersResult struct {
	UserIDs []string
}

type FriendEvent struct {
	RequestID string
	Type      string
	UserIDs   []string
}

type FriendNotifications interface {
	PublishFriendEvent(context.Context, FriendEvent)
}

type FriendshipMessageCommand struct {
	ActorUserID     string
	AddresseeUserID string
	CreatedAt       time.Time
	RequesterUserID string
}

type FriendshipMessageNotification func(context.Context)

type FriendshipMessageRecorder interface {
	RecordFriendshipCreated(context.Context, *gorm.DB, FriendshipMessageCommand) (FriendshipMessageNotification, error)
}

type DirectorySettings interface {
	ContactDirectoryMode(context.Context) (string, error)
}

type UserNicknamePolicy interface {
	UserNicknameEditingAllowed(context.Context) (bool, error)
}

type ListForIdentityCommand struct {
	Identity Identity
	Keyword  string
}

type ListAppsResult struct {
	Apps []App
}

type ListGroupsResult struct {
	Groups []Group
}

type ClientService interface {
	List(context.Context, ListCommand) (ListResult, error)
	ListUsers(context.Context, ListUsersCommand) (ListUsersResult, error)
	ResolveUsers(context.Context, ResolveUsersCommand) (ResolveUsersResult, error)
	ListFriendRequests(context.Context, ListFriendRequestsCommand) (ListFriendRequestsResult, error)
	CreateFriendRequest(context.Context, CreateFriendRequestCommand) (FriendRequest, error)
	AcceptFriendRequest(context.Context, UpdateFriendRequestCommand) (FriendRequest, error)
	RejectFriendRequest(context.Context, UpdateFriendRequestCommand) (FriendRequest, error)
	CancelFriendRequest(context.Context, UpdateFriendRequestCommand) (FriendRequest, error)
	DeleteFriend(context.Context, DeleteFriendCommand) error
	SearchUsers(context.Context, SearchUsersCommand) (SearchUsersResult, error)
}

type AppService interface {
	ListUsers(context.Context, ListUsersCommand) (ListUsersResult, error)
	ListAppsForIdentity(context.Context, ListForIdentityCommand) (ListAppsResult, error)
	ListGroupsForIdentity(context.Context, ListForIdentityCommand) (ListGroupsResult, error)
}
