package conversation

import (
	"context"
	"encoding/json"
	"io"
	"time"
)

type UserNicknamePolicy interface {
	UserNicknameEditingAllowed(context.Context) (bool, error)
}

const (
	MaxGroupMembers            = 1000
	MaxGroupNameLength         = 120
	MaxGroupAnnouncementLength = 200
	MaxGroupProjects           = 100
	MaxClientListItems         = 100
	MaxAvatarUploadBytes       = 1 * 1024 * 1024
	AvatarContentType          = "image/webp"
	MemberTypeUser             = "user"
	MemberTypeApp              = "app"
	VisibilityPublic           = "public"
	VisibilityPrivate          = "private"
)

type Identity struct {
	ID       string
	Email    string
	Name     string
	Nickname string
	Phone    string
	Avatar   string
}

type Actor = Identity

type Reference struct {
	ID   string
	Name string
	Type string
}

type MessageIdentity struct {
	Avatar string
	ID     string
	Name   string
	Type   string
}

type LastMessageSender struct {
	ID       string
	Name     string
	Nickname string
	Type     string
}

type Message struct {
	ClientMessageID  string
	Body             json.RawMessage
	ConversationID   string
	CreatedAt        time.Time
	DelegatedBy      *MessageIdentity
	ID               string
	ReplyToMessageID string
	RevokedAt        *time.Time
	RevokedByUserID  string
	Sender           MessageIdentity
	Seq              int64
	Summary          string
}

type Member struct {
	Avatar   string
	Email    string
	ID       string
	Name     string
	Nickname string
	Phone    string
	Role     string
	Type     string
}

type Project struct {
	Avatar      string
	Description string
	ID          string
	Name        string
}

type Item struct {
	Announcement       string
	Avatar             string
	CanSend            bool
	CreatedAt          time.Time
	ID                 string
	LastMessageAt      *time.Time
	LastMessageID      *string
	LastMessageSeq     int64
	LastMessageSender  *LastMessageSender
	LastMessageSummary string
	LastMentionedSeq   int64
	LastChoiceSeq      int64
	LastReadSeq        int64
	MemberCount        int
	Members            []Member
	Name               string
	NotificationMuted  bool
	Pinned             bool
	Projects           *[]Project
	Type               string
	Topic              *TopicMetadata
	UnreadCount        int64
	Visibility         string
}

type SearchSummary struct {
	Avatar string
	ID     string
	Name   string
	Type   string
}

type TopicMetadata struct {
	Archived               bool
	ParentConversationID   string
	ParentConversationName string
	ParentConversationType string
	Participating          bool
	SourceMessageID        string
	SourceMessageSeq       int64
	SourceSender           MessageIdentity
}

type TopicSourceReply struct {
	ID      string
	Sender  MessageIdentity
	Seq     int64
	Summary string
}

type TopicSourceMessage struct {
	Body      json.RawMessage
	CreatedAt time.Time
	ID        string
	ReplyTo   *TopicSourceReply
	RevokedAt *time.Time
	Sender    MessageIdentity
	Seq       int64
	Summary   string
}

type TopicDetail struct {
	CanArchive         bool
	CanParticipate     bool
	Conversation       Item
	ParentConversation Reference
	SourceMessage      TopicSourceMessage
}

type CreateTopicCommand struct {
	Actor                Actor
	ParentConversationID string
	SourceMessageID      string
}

type CreateTopicResult struct {
	Conversation Item
	Created      bool
}

type GetTopicCommand struct {
	Actor               Actor
	TopicConversationID string
}

type ListTopicsCommand struct {
	AccountID            string
	Cursor               string
	Limit                int
	ParentConversationID string
	Status               string
}

type ListTopicsResult struct {
	NextCursor *string
	Topics     []Item
}

type ParticipateTopicCommand struct {
	Actor               Actor
	TopicConversationID string
}

type ArchiveTopicCommand struct {
	Actor               Actor
	TopicConversationID string
}

type AppCreateTopicCommand struct {
	AppID                string
	ParentConversationID string
	SourceMessageID      string
}

type AppCloseTopicCommand struct {
	AppID                  string
	ExpectedLastMessageSeq int64
	TopicConversationID    string
}

type AppGetTopicCommand struct {
	AppID               string
	TopicConversationID string
}

type AppTopicResult struct {
	Archived             bool
	ConversationID       string
	Created              bool
	LastMessageSeq       int64
	Name                 string
	ParentConversationID string
	SourceMessageID      string
	Type                 string
}

type TopicEvent struct {
	Archived             bool
	ConversationID       string
	ParentConversationID string
	SourceMessageID      string
	Type                 string
}

type ConversationPinEvent struct {
	ConversationID string
	Pinned         bool
}

type ConversationMuteEvent struct {
	ConversationID string
	Muted          bool
}

type Group struct {
	Announcement       string
	Avatar             string
	CreatedAt          time.Time
	CreatedByUserID    string
	ID                 string
	LastMessageAt      *time.Time
	LastMessageID      *string
	LastMessageSeq     int64
	LastMessageSender  *LastMessageSender
	LastMessageSummary string
	LastMentionedSeq   int64
	LastChoiceSeq      int64
	LastReadSeq        int64
	MemberCount        int
	Members            []Member
	Name               string
	PostingPolicy      string
	Status             string
	Type               string
	UnreadCount        int64
	Visibility         string
}

type ListCommand struct {
	AccountID             string
	IncludeConversationID string
}

type ListResult struct {
	Conversations []Item
}

type AppListCommand struct {
	ActorID string
	Keyword string
	Limit   int
}

type AppSummary struct {
	ConversationID string
	LastActiveAt   time.Time
	MemberCount    int
	Name           string
	Type           string
}

type AppListResult struct {
	Conversations []AppSummary
}

type AppGroupListResult struct {
	Groups []Item
}

type ReadCommand struct {
	AccountID      string
	ConversationID string
	UpToSeq        *int64
}

type ReadResult struct {
	ConversationID string
	LastReadSeq    int64
	UnreadCount    int64
}

type SetPinCommand struct {
	AccountID      string
	ConversationID string
	Pinned         bool
}

type SetPinResult struct {
	ConversationID string
	Pinned         bool
}

type SetMuteCommand struct {
	AccountID      string
	ConversationID string
	Muted          bool
}

type SetMuteResult struct {
	ConversationID string
	Muted          bool
}

type DismissCommand struct {
	AccountID      string
	ConversationID string
}

type DismissResult struct {
	ConversationID string
}

type RestoreCommand struct {
	AccountID      string
	ConversationID string
}

type CreateDirectCommand struct {
	Actor  Actor
	UserID string
}

type RecordFriendshipCreatedCommand struct {
	ActorUserID     string
	AddresseeUserID string
	CreatedAt       time.Time
	RequesterUserID string
}

type RecordFriendshipCreatedResult struct {
	Message         Message
	RestoredUserIDs []string
	UserIDs         []string
}

type CreateAppCommand struct {
	Actor Actor
	AppID string
}

type OpenResult struct {
	Conversation Item
	Created      bool
}

type CreateGroupCommand struct {
	Actor      Actor
	Name       string
	MemberIDs  []string
	AppIDs     []string
	ProjectIDs []string
}

type CreateGroupResult struct {
	Conversation Group
	Message      *Message
}

type AddMembersCommand struct {
	Actor          Actor
	ConversationID string
	MemberIDs      []string
	AppIDs         []string
}

type RemoveMemberCommand struct {
	Actor          Actor
	ConversationID string
	MemberType     string
	MemberID       string
}

type UpdateNameCommand struct {
	Actor          Actor
	ConversationID string
	Name           string
}

type UpdateAnnouncementCommand struct {
	Actor          Actor
	Announcement   string
	ConversationID string
}

type UpdateVisibilityCommand struct {
	Actor          Actor
	ConversationID string
	Visibility     string
}

type ConversationMutationResult struct {
	Conversation Item
	Message      *Message
}

type JoinCommand struct {
	Actor          Actor
	ConversationID string
}

type LeaveCommand struct {
	Actor          Actor
	ConversationID string
}

type LeaveResult struct {
	ConversationID string
	Message        Message
}

type DissolveCommand struct {
	Actor          Actor
	ConversationID string
}

type DissolveResult struct {
	ConversationID string
}

type UploadAvatarCommand struct {
	Authorization AvatarUploadAuthorization
	Size          int64
	Content       io.Reader
}

type AuthorizeAvatarCommand struct {
	Actor          Actor
	ConversationID string
}

type AvatarUploadAuthorization struct {
	actor          Actor
	conversationID string
	valid          bool
}

type UpdateAvatarResult struct {
	Conversation Item
	Message      Message
}

type ClientService interface {
	List(context.Context, ListCommand) (ListResult, error)
	MarkRead(context.Context, ReadCommand) (ReadResult, error)
	Dismiss(context.Context, DismissCommand) (DismissResult, error)
	Restore(context.Context, RestoreCommand) (Item, error)
	SetMuted(context.Context, SetMuteCommand) (SetMuteResult, error)
	SetPinned(context.Context, SetPinCommand) (SetPinResult, error)
	CreateDirect(context.Context, CreateDirectCommand) (OpenResult, error)
	CreateApp(context.Context, CreateAppCommand) (OpenResult, error)
	CreateGroup(context.Context, CreateGroupCommand) (CreateGroupResult, error)
	AddMembers(context.Context, AddMembersCommand) (ConversationMutationResult, error)
	RemoveMember(context.Context, RemoveMemberCommand) (ConversationMutationResult, error)
	UpdateName(context.Context, UpdateNameCommand) (ConversationMutationResult, error)
	UpdateAnnouncement(context.Context, UpdateAnnouncementCommand) (ConversationMutationResult, error)
	UpdateVisibility(context.Context, UpdateVisibilityCommand) (ConversationMutationResult, error)
	Join(context.Context, JoinCommand) (ConversationMutationResult, error)
	Leave(context.Context, LeaveCommand) (LeaveResult, error)
	Dissolve(context.Context, DissolveCommand) (DissolveResult, error)
	AuthorizeAvatarUpdate(context.Context, AuthorizeAvatarCommand) (AvatarUploadAuthorization, error)
	UploadAvatar(context.Context, UploadAvatarCommand) (UpdateAvatarResult, error)
	CreateTopic(context.Context, CreateTopicCommand) (CreateTopicResult, error)
	GetTopic(context.Context, GetTopicCommand) (TopicDetail, error)
	ListTopics(context.Context, ListTopicsCommand) (ListTopicsResult, error)
	ParticipateTopic(context.Context, ParticipateTopicCommand) (Item, error)
	ArchiveTopic(context.Context, ArchiveTopicCommand) (Item, error)
}

type AppService interface {
	ListForActor(context.Context, AppListCommand) (AppListResult, error)
	ListGroupsForActor(context.Context, AppListCommand) (AppGroupListResult, error)
	CreateGroup(context.Context, CreateGroupCommand) (CreateGroupResult, error)
	AddMembers(context.Context, AddMembersCommand) (ConversationMutationResult, error)
	OpenDirectForUsers(context.Context, Identity, Identity) (Reference, bool, error)
	OpenAppForUser(context.Context, Identity, string) (Reference, bool, error)
	CreateTopicAsApp(context.Context, AppCreateTopicCommand) (AppTopicResult, error)
	GetTopicAsApp(context.Context, AppGetTopicCommand) (AppTopicResult, error)
	CloseTopicAsApp(context.Context, AppCloseTopicCommand) (AppTopicResult, error)
}
