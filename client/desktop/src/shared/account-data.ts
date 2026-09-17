import type { AuthResult } from "./auth"

export const ACCOUNT_DATA_CHANNELS = {
  initialize: "desktop-next:v1:account-data-initialize",
  listConversations: "desktop-next:v1:conversations-list",
  listMessages: "desktop-next:v1:conversation-messages-list",
  loadBeforeMessages: "desktop-next:v1:conversation-messages-load-before",
  setMessageReaction: "desktop-next:v1:conversation-message-reaction-set",
  listMessageReactionUsers: "desktop-next:v1:conversation-message-reaction-users-list",
  sendTextMessage: "desktop-next:v1:conversation-message-text-send",
  selectMessageFile: "desktop-next:v1:conversation-message-file-select",
  selectMessageMedia: "desktop-next:v1:conversation-message-media-select",
  sendFileMessage: "desktop-next:v1:conversation-message-file-send",
  sendImageMessage: "desktop-next:v1:conversation-message-image-send",
  sendVideoMessage: "desktop-next:v1:conversation-message-video-send",
  retryMessage: "desktop-next:v1:conversation-message-retry",
  getContacts: "desktop-next:v1:contacts-get",
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
  topic?: { conversationId: string; archived: boolean }
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
}

export type DesktopContactDirectory = {
  mode: "organization" | "friends"
  users: DesktopContactUser[]
  groups: DesktopContactGroup[]
  apps: DesktopContactApp[]
}

export type SendTextMessageInput = {
  targetId: string
  conversationId: string
  content: string
  bodyType: "text" | "markdown"
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

export interface AccountDataBridge {
  initialize(targetId: string): Promise<AuthResult<null>>
  listConversations(targetId: string): Promise<AuthResult<DesktopConversation[]>>
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
  selectMessageFile(targetId: string): Promise<AuthResult<SelectedMessageFile | null>>
  selectMessageMedia(input: {
    targetId: string
    category: "image" | "video"
  }): Promise<AuthResult<SelectedMessageMedia | null>>
  sendFileMessage(input: SendFileMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendImageMessage(input: SendImageMessageInput): Promise<AuthResult<DesktopMessage[]>>
  sendVideoMessage(input: SendVideoMessageInput): Promise<AuthResult<DesktopMessage[]>>
  retryMessage(input: RetryMessageInput): Promise<AuthResult<DesktopMessage[]>>
  setMessageReaction(input: SetMessageReactionInput): Promise<AuthResult<DesktopMessage[]>>
  listMessageReactionUsers(
    input: MessageReactionUsersInput,
  ): Promise<AuthResult<DesktopMessageReactionUser[]>>
  getContacts(targetId: string): Promise<AuthResult<DesktopContactDirectory>>
  getAvatar(input: AvatarRequest): Promise<AuthResult<AvatarResult>>
  invalidateAvatar(input: Omit<AvatarRequest, "theme">): Promise<AuthResult<null>>
  onSyncStateChange(callback: (event: AccountDataSyncEvent) => void): () => void
  onChanged(callback: (event: AccountDataChangedEvent) => void): () => void
}
