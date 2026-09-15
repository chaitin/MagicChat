import type { AuthResult } from "./auth"

export const ACCOUNT_DATA_CHANNELS = {
  initialize: "desktop-next:v1:account-data-initialize",
  listConversations: "desktop-next:v1:conversations-list",
  listMessages: "desktop-next:v1:conversation-messages-list",
  getContacts: "desktop-next:v1:contacts-get",
} as const

export type DesktopConversation = {
  id: string
  type: string
  name: string
  avatar: string
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
  avatar: string
  email: string
  phone: string
  online: boolean
}

export type DesktopContactGroup = {
  id: string
  name: string
  avatar: string
  joined: boolean
  memberCount: number
  visibility: string
}

export type DesktopContactApp = {
  id: string
  name: string
  avatar: string
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
}
