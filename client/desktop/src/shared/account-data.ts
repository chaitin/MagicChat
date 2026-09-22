import type { AuthResult } from "./auth"

export const ACCOUNT_DATA_CHANNELS = {
  initialize: "desktop-next:v1:account-data-initialize",
  refreshAll: "desktop-next:v1:account-data-refresh-all",
  searchLocal: "desktop-next:v1:account-data-search-local",
  listConversations: "desktop-next:v1:conversations-list",
  createGroupConversation: "desktop-next:v1:conversation-group-create",
  listMessages: "desktop-next:v1:conversation-messages-list",
  loadBeforeMessages: "desktop-next:v1:conversation-messages-load-before",
  setMessageReaction: "desktop-next:v1:conversation-message-reaction-set",
  submitChoiceResponse: "desktop-next:v1:conversation-message-choice-submit",
  listMessageReactionUsers: "desktop-next:v1:conversation-message-reaction-users-list",
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

export type AvatarType = "user" | "group" | "topic" | "app" | "project"
export type AvatarRequest = {
  targetId: string
  type: AvatarType
  id: string
  theme: "light" | "dark"
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
  avatarType: Exclude<AvatarType, "topic">
  avatarId: string
  createdAt: string
  lastMessageAt: string | null
  lastMessageSummary: string
  pinned: boolean
  notificationMuted: boolean
  isBuiltinAssistant: boolean
  unreadCount: number
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
  | { type: "revoked" }
  | { type: "unsupported" }

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
  replyTo?: { id: string; author: string; summary: string }
  reactions: Array<{
    text: string
    count: number
    reactedByMe: boolean
    users: DesktopMessageReactionUser[]
  }>
  choice?: DesktopMessageChoiceState
  topic?: { conversationId: string; archived: boolean }
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
}

export type SendRichMessageBody =
  | Extract<DesktopMessageBody, { type: "choice" }>
  | Extract<DesktopMessageBody, { type: "chart" }>

export type SendRichMessageInput = {
  targetId: string
  conversationId: string
  body: SendRichMessageBody
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
}

export type SendVideoMessageInput = {
  targetId: string
  conversationId: string
  selectionToken: string
  caption: string
}

export type RetryMessageInput = {
  targetId: string
  conversationId: string
  clientMessageId: string
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
  listConversations(targetId: string): Promise<AuthResult<DesktopConversation[]>>
  createGroupConversation(
    input: CreateGroupConversationInput,
  ): Promise<AuthResult<DesktopConversation>>
  listMessages(input: {
    targetId: string
    conversationId: string
  }): Promise<AuthResult<DesktopMessage[]>>
  loadBeforeMessages(input: {
    targetId: string
    conversationId: string
    beforeSeq: number
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
  setMessageReaction(input: SetMessageReactionInput): Promise<AuthResult<DesktopMessage[]>>
  submitChoiceResponse(input: SubmitChoiceResponseInput): Promise<AuthResult<DesktopMessage[]>>
  listMessageReactionUsers(
    input: MessageReactionUsersInput,
  ): Promise<AuthResult<DesktopMessageReactionUser[]>>
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
}
