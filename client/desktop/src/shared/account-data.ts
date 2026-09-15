import type { AuthResult } from "./auth"

export const ACCOUNT_DATA_CHANNELS = {
  initialize: "desktop-next:v1:account-data-initialize",
  listConversations: "desktop-next:v1:conversations-list",
  listMessages: "desktop-next:v1:conversation-messages-list",
  getContacts: "desktop-next:v1:contacts-get",
  getAvatar: "desktop-next:v1:avatar-get",
  invalidateAvatar: "desktop-next:v1:avatar-invalidate",
} as const

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
  avatarType: Exclude<AvatarType, "topic">
  avatarId: string
  lastMessageAt: string | null
  lastMessageSummary: string
  pinned: boolean
  unreadCount: number
}

export type DesktopMessage = {
  id: string
  conversationId: string
  seq: number
  createdAt: string
  senderId: string
  senderType: string
  isMine: boolean
  bodyType: string
  content: string
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

export interface AccountDataBridge {
  initialize(targetId: string): Promise<AuthResult<null>>
  listConversations(targetId: string): Promise<AuthResult<DesktopConversation[]>>
  listMessages(input: {
    targetId: string
    conversationId: string
  }): Promise<AuthResult<DesktopMessage[]>>
  getContacts(targetId: string): Promise<AuthResult<DesktopContactDirectory>>
  getAvatar(input: AvatarRequest): Promise<AuthResult<AvatarResult>>
  invalidateAvatar(input: Omit<AvatarRequest, "theme">): Promise<AuthResult<null>>
}
