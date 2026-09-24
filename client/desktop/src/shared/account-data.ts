import type { AuthResult } from "./auth"

export const ACCOUNT_DATA_CHANNELS = {
  initialize: "desktop-next:v1:account-data-initialize",
  refreshAll: "desktop-next:v1:account-data-refresh-all",
  searchLocal: "desktop-next:v1:account-data-search-local",
  listConversations: "desktop-next:v1:conversations-list",
  listLocalTopics: "desktop-next:v1:conversation-topics-local-list",
  listLocalAttachments: "desktop-next:v1:conversation-attachments-local-list",
  getLocalMessageContext: "desktop-next:v1:message-context-local-get",
  listLocalMessagesAfter: "desktop-next:v1:messages-after-local-list",
  getConversationInfo: "desktop-next:v1:conversation-info-get",
  addGroupMembers: "desktop-next:v1:conversation-members-add",
  manageGroup: "desktop-next:v1:conversation-group-manage",
  createGroupConversation: "desktop-next:v1:conversation-group-create",
  setConversationPinned: "desktop-next:v1:conversation-pin-set",
  setConversationMuted: "desktop-next:v1:conversation-mute-set",
  markConversationRead: "desktop-next:v1:conversation-read-mark",
  dismissConversation: "desktop-next:v1:conversation-dismiss",
  listMessages: "desktop-next:v1:conversation-messages-list",
  loadBeforeMessages: "desktop-next:v1:conversation-messages-load-before",
  setMessageReaction: "desktop-next:v1:conversation-message-reaction-set",
  submitChoiceResponse: "desktop-next:v1:conversation-message-choice-submit",
  listMessageReactionUsers: "desktop-next:v1:conversation-message-reaction-users-list",
  resolveUserNames: "desktop-next:v1:user-names-resolve",
  sendTextMessage: "desktop-next:v1:conversation-message-text-send",
  sendRichMessage: "desktop-next:v1:conversation-message-rich-send",
  selectMessageFile: "desktop-next:v1:conversation-message-file-select",
  importMessageFile: "desktop-next:v1:conversation-message-file-import",
  releaseMessageFile: "desktop-next:v1:conversation-message-file-release",
  selectMessageMedia: "desktop-next:v1:conversation-message-media-select",
  sendFileMessage: "desktop-next:v1:conversation-message-file-send",
  sendImageMessage: "desktop-next:v1:conversation-message-image-send",
  sendVideoMessage: "desktop-next:v1:conversation-message-video-send",
  retryMessage: "desktop-next:v1:conversation-message-retry",
  createMessageTopic: "desktop-next:v1:conversation-message-topic-create",
  revokeMessage: "desktop-next:v1:conversation-message-revoke",
  sendConversationStatus: "desktop-next:v1:conversation-status-send",
  conversationPresenceChanged: "desktop-next:v1:conversation-presence-changed",
  getContacts: "desktop-next:v1:contacts-get",
  refreshContacts: "desktop-next:v1:contacts-refresh",
  searchContactUsers: "desktop-next:v1:contacts-users-search",
  listFriendRequests: "desktop-next:v1:contacts-friend-requests-list",
  createFriendRequest: "desktop-next:v1:contacts-friend-request-create",
  acceptFriendRequest: "desktop-next:v1:contacts-friend-request-accept",
  rejectFriendRequest: "desktop-next:v1:contacts-friend-request-reject",
  cancelFriendRequest: "desktop-next:v1:contacts-friend-request-cancel",
  deleteFriend: "desktop-next:v1:contacts-friend-delete",
  openContactConversation: "desktop-next:v1:contacts-conversation-open",
  createClientApp: "desktop-next:v1:contacts-app-create",
  getClientApp: "desktop-next:v1:contacts-app-get",
  updateClientApp: "desktop-next:v1:contacts-app-update",
  deleteClientApp: "desktop-next:v1:contacts-app-delete",
  regenerateClientAppSecret: "desktop-next:v1:contacts-app-secret-regenerate",
  selectClientAppAvatar: "desktop-next:v1:contacts-app-avatar-select",
  uploadClientAppAvatar: "desktop-next:v1:contacts-app-avatar-upload",
  getAvatar: "desktop-next:v1:avatar-get",
  invalidateAvatar: "desktop-next:v1:avatar-invalidate",
  syncStateChanged: "desktop-next:v1:account-data-sync-state-changed",
  changed: "desktop-next:v1:account-data-changed",
} as const

export type AccountDataDomain = "conversations" | "messages" | "contacts"
export type AccountDataSyncEvent = {
  targetId: string
  state: "loading" | "ready"
}
export type AccountDataChangedEvent = {
  targetId: string
  revision: number
  domains: AccountDataDomain[]
  conversationIds: string[]
}

export type ConversationPresenceSender = {
  id: string
  type: "user" | "app"
}

export type ConversationPresenceEvent =
  | {
      targetId: string
      name: "conversation.status"
      conversationId: string
      status: string
      sender: ConversationPresenceSender
    }
  | {
      targetId: string
      name: "message.created"
      conversationId: string
      sender: ConversationPresenceSender
    }

export type AvatarType = "user" | "group" | "topic" | "app" | "project"
export type AvatarRequest = {
  targetId: string
  type: AvatarType
  id: string
  theme: "light" | "dark"
  cacheOnly?: boolean
}
export type AvatarResult = {
  status: "ready" | "fallback"
  type: Exclude<AvatarType, "topic">
  resourceUrl?: string
}

export type DesktopConversation = {
  id: string
  type: string
  name: string
  memberCount: number
  members?: DesktopConversationMember[]
  avatarType: AvatarType
  avatarId: string
  createdAt: string
  lastMessageAt: string | null
  lastMessageSummary: string
  pinned: boolean
  notificationMuted: boolean
  isBuiltinAssistant: boolean
  canSend?: boolean
  canModerateMessages?: boolean
  unreadCount: number
  lastMessageSeq?: number
  lastReadSeq?: number
  topic?: DesktopConversationTopic
}

export type DesktopConversationMember = {
  id: string
  type: "user" | "app"
  name: string
  nickname: string
  email: string
  phone: string
}

export type DesktopConversationTopic = {
  archived: boolean
  parentConversationId: string
  sourceMessageId?: string
  parentConversationType?: string
  participating: boolean
  sourceSender: {
    id: string
    name: string
    type: "user" | "app"
  }
}

export type DesktopConversationInfo = {
  announcement: string
  visibility: string
  members: Array<{ id: string; type: "user" | "app"; name: string; role: string }>
}

export type DesktopLocalPage<T> = { items: T[]; nextOffset: number | null }
export type DesktopLocalAttachment = {
  id: string
  createdAt: string
  body: Extract<DesktopMessageBody, { type: "file" }>
}

export type DesktopMessageBody =
  | { type: "text" | "markdown"; content: string }
  | {
      type: "choice"
      content: string
      contentType: "text" | "markdown"
      selection: "single" | "multiple"
      options: Array<{ id: string; label: string }>
    }
  | { type: "link"; title: string; url: string }
  | { type: "card"; title: string; description: string; url: string }
  | { type: "chart"; chartType: string; title: string; description: string; data: unknown }
  | { type: "file"; fileId: string; name: string; sizeBytes: number }
  | {
      type: "image"
      fileId: string
      caption?: string
      captionType?: "text" | "markdown"
      width?: number
      height?: number
    }
  | {
      type: "video"
      fileId: string
      name: string
      sizeBytes: number
      contentType: string
      caption?: string
      captionType?: "text" | "markdown"
    }
  | {
      type: "voice"
      fileId: string
      sizeBytes: number
      durationMS: number
      contentType: string
      transcript: string
    }
  | {
      type: "forward_bundle"
      itemCount: number
      items: Array<{
        senderName: string
        senderType: string
        sentAt: string
        summary: string
        body: DesktopMessageBody
      }>
    }
  | { type: "system_event"; event: string; summary: string }
  | {
      type: "revoked"
      editableBody?: { type: "text" | "markdown"; content: string }
    }
  | { type: "unsupported" }

export type DesktopMessageReplyTarget = {
  id: string
  author: string
  summary: string
}

export type DesktopMessage = {
  id: string
  conversationId: string
  seq: number
  createdAt: string
  senderId: string
  senderType: string
  senderName: string
  isMine: boolean
  bodyType: string
  content: string
  clientMessageId: string
  deliveryStatus?: "sending" | "failed"
  body: DesktopMessageBody
  replyTo?: DesktopMessageReplyTarget
  reactions: Array<{
    text: string
    count: number
    reactedByMe: boolean
    users: DesktopMessageReactionUser[]
  }>
  choice?: DesktopMessageChoiceState
  topic?: {
    conversationId: string
    archived: boolean
    recentReplies: DesktopMessageTopicReply[]
  }
  virtualType?: "topic_source"
}

export type DesktopMessageTopicReply = {
  id: string
  createdAt: string
  senderId: string
  senderType: "user" | "app"
  summary: string
}

export type DesktopMessageChoiceState = {
  myOptionIds: string[]
  options: Array<{ id: string; responseCount: number }>
  responseCount: number
}

export type DesktopMessageReactionUser = {
  id: string
  name: string
}

export type ResolveUserNamesInput = { targetId: string; userIds: string[] }

export type DesktopMessagePage = {
  messages: DesktopMessage[]
  hasMoreBefore: boolean
}

export type DesktopContactUser = {
  id: string
  name: string
  nickname: string
  avatarType: "user"
  avatarId: string
  email: string
  phone: string
  online: boolean
  lastOnlineAt?: string | null
}

export type DesktopContactGroup = {
  id: string
  name: string
  avatarType: "group"
  avatarId: string
  joined: boolean
  memberCount: number
  visibility: string
}

export type DesktopContactApp = {
  id: string
  name: string
  avatarType: "app"
  avatarId: string
  description: string
  online: boolean
  creatorUserId?: string | null
}

export type DesktopContactDirectory = {
  mode: "organization" | "friends"
  users: DesktopContactUser[]
  groups: DesktopContactGroup[]
  apps: DesktopContactApp[]
}

export type DesktopFriendRequest = {
  id: string
  requesterUserId: string
  addresseeUserId: string
  status: "pending" | "accepted" | "rejected" | "canceled"
  createdAt: string
  updatedAt: string
  handledAt: string | null
}

export type ClientAppVisibility = "creator" | "public" | "restricted"

export type DesktopClientApp = {
  id: string
  name: string
  description: string
  avatar: string
  visibility: ClientAppVisibility
  userIds: string[]
  enabled: boolean
  connectionStatus: "disabled" | "offline" | "online"
  createdAt: string
  updatedAt: string
}

export type DesktopClientAppCredentials = {
  app: DesktopClientApp
  connectionSecret: string
}

export type ContactTargetInput = {
  targetId: string
  id: string
}

export type FriendRequestListInput = {
  targetId: string
  direction: "incoming" | "outgoing"
}

export type OpenContactConversationInput = ContactTargetInput & {
  type: "user" | "app" | "group"
  joined?: boolean
}

export type CreateGroupConversationInput = {
  targetId: string
  name: string
  memberIds: string[]
  appIds: string[]
}

export type ConversationTargetInput = { targetId: string; conversationId: string }
export type LocalConversationPageInput = ConversationTargetInput & { offset?: number; keyword?: string }
export type LocalAttachmentPageInput = LocalConversationPageInput
export type LocalMessageContextInput = ConversationTargetInput & { messageId: string }
export type LocalMessagesAfterInput = ConversationTargetInput & { afterSeq: number }
export type DesktopLocalMessageWindow = {
  messages: DesktopMessage[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
}
export type AddGroupMembersInput = ConversationTargetInput & {
  memberIds: string[]
  appIds: string[]
}

export type ManageGroupInput = ConversationTargetInput & (
  | { action: "name" | "announcement"; value: string }
  | { action: "public" | "private" | "leave" | "dissolve" }
  | { action: "remove-member"; memberId: string; memberType: "user" | "app" }
)

export type SetConversationPinnedInput = {
  targetId: string
  conversationId: string
  pinned: boolean
}

export type SetConversationMutedInput = {
  targetId: string
  conversationId: string
  muted: boolean
}

export type ListConversationsInput = {
  targetId: string
  selectedConversationId?: string | null
}

export type MarkConversationReadInput = {
  targetId: string
  conversationId: string
  upToSeq: number
}

export type DismissConversationInput = {
  targetId: string
  conversationId: string
}

export type LocalSearchCategory = "all" | "contacts" | "apps" | "groups" | "messages"

export type LocalSearchInput = {
  targetId: string
  query: string
  category: LocalSearchCategory
}

export type LocalSearchContactResult = DesktopContactUser & { kind: "contact" }
export type LocalSearchAppResult = DesktopContactApp & { kind: "app" }
export type LocalSearchGroupResult = DesktopContactGroup & { kind: "group" }
export type LocalSearchMessageResult = {
  kind: "message"
  id: string
  conversationId: string
  conversationName: string
  conversationAvatarType: AvatarType
  conversationAvatarId: string
  senderName: string
  createdAt: string
  summary: string
}

export type LocalSearchResult =
  | LocalSearchContactResult
  | LocalSearchAppResult
  | LocalSearchGroupResult
  | LocalSearchMessageResult

export type LocalSearchSection<T> = {
  items: T[]
  hasMore: boolean
}

export type LocalSearchResponse = {
  contacts: LocalSearchSection<LocalSearchContactResult>
  apps: LocalSearchSection<LocalSearchAppResult>
  groups: LocalSearchSection<LocalSearchGroupResult>
  messages: LocalSearchSection<LocalSearchMessageResult>
}

export type SaveClientAppInput = {
  targetId: string
  name: string
  description: string
  visibility: ClientAppVisibility
  userIds: string[]
}

export type UpdateClientAppInput = SaveClientAppInput & { appId: string }

export type SelectedClientAppAvatar = SelectedMessageFile & {
  contentType: "image/jpeg" | "image/png" | "image/webp"
  resourceUrl: string
}

export type UploadClientAppAvatarInput = {
  targetId: string
  appId: string
  selectionToken: string
}

export type SendTextMessageInput = {
  targetId: string
  conversationId: string
  content: string
  bodyType: "text" | "markdown" | "link"
  replyToMessageId?: string
}

export type SendRichMessageBody =
  | Extract<DesktopMessageBody, { type: "choice" }>
  | Extract<DesktopMessageBody, { type: "chart" }>

export type SendRichMessageInput = {
  targetId: string
  conversationId: string
  body: SendRichMessageBody
  replyToMessageId?: string
}

export type SelectedMessageFile = {
  token: string
  name: string
  sizeBytes: number
}

export type SendFileMessageInput = {
  targetId: string
  conversationId: string
  selectionToken: string
  replyToMessageId?: string
}

export type ImportedMessageFile = SelectedMessageFile | SelectedMessageMedia

export type SelectedMessageMedia = SelectedMessageFile & {
  category: "image" | "video"
  contentType: string
  resourceUrl: string
}

export type SendImageMessageInput = {
  targetId: string
  conversationId: string
  selectionToken: string
  bytes: ArrayBuffer
  name: string
  contentType: "image/webp" | "image/png"
  width: number
  height: number
  caption: string
  replyToMessageId?: string
}

export type SendVideoMessageInput = {
  targetId: string
  conversationId: string
  selectionToken: string
  caption: string
  replyToMessageId?: string
}

export type RetryMessageInput = {
  targetId: string
  conversationId: string
  clientMessageId: string
}

export type CreateMessageTopicInput = {
  targetId: string
  conversationId: string
  messageId: string
}

export type CreateMessageTopicResult = {
  conversation: DesktopConversation
  conversations: DesktopConversation[]
  messages: DesktopMessage[]
  created: boolean
}

export type RevokeMessageInput = {
  targetId: string
  conversationId: string
  messageId: string
}

export type SendConversationStatusInput = {
  targetId: string
  conversationId: string
}

export type MessageReactionUsersInput = {
  targetId: string
  conversationId: string
  messageId: string
  text: string
}

export type SetMessageReactionInput = {
  targetId: string
  conversationId: string
  messageId: string
  text: string
  reacted: boolean
}

export type SubmitChoiceResponseInput = {
  targetId: string
  conversationId: string
  messageId: string
  optionIds: string[]
}

export interface AccountDataBridge {
  initialize(targetId: string): Promise<AuthResult<null>>
  refreshAll(targetId: string): Promise<AuthResult<null>>
  searchLocal(input: LocalSearchInput): Promise<AuthResult<LocalSearchResponse>>
  listConversations(input: ListConversationsInput): Promise<AuthResult<DesktopConversation[]>>
  listLocalTopics(input: LocalConversationPageInput): Promise<AuthResult<DesktopLocalPage<DesktopConversation>>>
  listLocalAttachments(input: LocalAttachmentPageInput): Promise<AuthResult<DesktopLocalPage<DesktopLocalAttachment>>>
  getLocalMessageContext(input: LocalMessageContextInput): Promise<AuthResult<DesktopLocalMessageWindow>>
  listLocalMessagesAfter(input: LocalMessagesAfterInput): Promise<AuthResult<DesktopLocalMessageWindow>>
  getConversationInfo(input: ConversationTargetInput): Promise<AuthResult<DesktopConversationInfo>>
  addGroupMembers(input: AddGroupMembersInput): Promise<AuthResult<DesktopConversation>>
  manageGroup(input: ManageGroupInput): Promise<AuthResult<DesktopConversation | null>>
  createGroupConversation(
    input: CreateGroupConversationInput,
  ): Promise<AuthResult<DesktopConversation>>
  setConversationPinned(
    input: SetConversationPinnedInput,
  ): Promise<AuthResult<DesktopConversation[]>>
  setConversationMuted(input: SetConversationMutedInput): Promise<AuthResult<DesktopConversation[]>>
  markConversationRead(input: MarkConversationReadInput): Promise<AuthResult<null>>
  dismissConversation(input: DismissConversationInput): Promise<AuthResult<DesktopConversation[]>>
  listMessages(input: {
    targetId: string
    conversationId: string
    latestLimit: number
  }): Promise<AuthResult<DesktopMessage[]>>
  loadBeforeMessages(input: {
    targetId: string
    conversationId: string
    beforeSeq: number
    loadedCount: number
  }): Promise<AuthResult<DesktopMessagePage>>
  sendTextMessage(input: SendTextMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendRichMessage(input: SendRichMessageInput): Promise<AuthResult<DesktopMessage[]>>
  selectMessageFile(targetId: string): Promise<AuthResult<SelectedMessageFile | null>>
  importMessageFile(input: {
    targetId: string
    file: File
  }): Promise<AuthResult<ImportedMessageFile>>
  releaseMessageFile(input: { targetId: string; token: string }): Promise<AuthResult<null>>
  selectMessageMedia(input: {
    targetId: string
    category: "image" | "video"
  }): Promise<AuthResult<SelectedMessageMedia | null>>
  sendFileMessage(input: SendFileMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendImageMessage(input: SendImageMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendVideoMessage(input: SendVideoMessageInput): Promise<AuthResult<DesktopMessage[]>>
  retryMessage(input: RetryMessageInput): Promise<AuthResult<DesktopMessage[]>>
  createMessageTopic(input: CreateMessageTopicInput): Promise<AuthResult<CreateMessageTopicResult>>
  revokeMessage(input: RevokeMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendConversationStatus(input: SendConversationStatusInput): Promise<AuthResult<void>>
  setMessageReaction(input: SetMessageReactionInput): Promise<AuthResult<DesktopMessage[]>>
  submitChoiceResponse(input: SubmitChoiceResponseInput): Promise<AuthResult<DesktopMessage[]>>
  listMessageReactionUsers(
    input: MessageReactionUsersInput,
  ): Promise<AuthResult<DesktopMessageReactionUser[]>>
  resolveUserNames(input: ResolveUserNamesInput): Promise<AuthResult<DesktopMessageReactionUser[]>>
  getContacts(targetId: string): Promise<AuthResult<DesktopContactDirectory>>
  refreshContacts(targetId: string): Promise<AuthResult<DesktopContactDirectory>>
  searchContactUsers(input: {
    targetId: string
    query: string
  }): Promise<AuthResult<DesktopContactUser[]>>
  listFriendRequests(input: FriendRequestListInput): Promise<AuthResult<DesktopFriendRequest[]>>
  createFriendRequest(input: ContactTargetInput): Promise<AuthResult<DesktopFriendRequest>>
  acceptFriendRequest(input: ContactTargetInput): Promise<AuthResult<DesktopFriendRequest>>
  rejectFriendRequest(input: ContactTargetInput): Promise<AuthResult<DesktopFriendRequest>>
  cancelFriendRequest(input: ContactTargetInput): Promise<AuthResult<DesktopFriendRequest>>
  deleteFriend(input: ContactTargetInput): Promise<AuthResult<null>>
  openContactConversation(
    input: OpenContactConversationInput,
  ): Promise<AuthResult<DesktopConversation>>
  createClientApp(input: SaveClientAppInput): Promise<AuthResult<DesktopClientAppCredentials>>
  getClientApp(input: ContactTargetInput): Promise<AuthResult<DesktopClientAppCredentials>>
  updateClientApp(input: UpdateClientAppInput): Promise<AuthResult<DesktopClientApp>>
  deleteClientApp(input: ContactTargetInput): Promise<AuthResult<null>>
  regenerateClientAppSecret(
    input: ContactTargetInput,
  ): Promise<AuthResult<DesktopClientAppCredentials>>
  selectClientAppAvatar(targetId: string): Promise<AuthResult<SelectedClientAppAvatar | null>>
  uploadClientAppAvatar(input: UploadClientAppAvatarInput): Promise<AuthResult<DesktopClientApp>>
  getAvatar(input: AvatarRequest): Promise<AuthResult<AvatarResult>>
  invalidateAvatar(input: Omit<AvatarRequest, "theme">): Promise<AuthResult<null>>
  onSyncStateChange(callback: (event: AccountDataSyncEvent) => void): () => void
  onChanged(callback: (event: AccountDataChangedEvent) => void): () => void
  onConversationPresenceChanged(callback: (event: ConversationPresenceEvent) => void): () => void
}
