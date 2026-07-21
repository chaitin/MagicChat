export type AppInfo = {
  appName: string
  authenticated: boolean
  emailCodeLoginEnabled: boolean
  organizationName: string
  passwordLoginEnabled: boolean
}

export type AuthenticatedUser = {
  email: string
  id: string
  name: string
}

export type ClientUser = {
  avatar: string
  createdAt: string
  email: string
  id: string
  lastOnlineAt: string | null
  name: string
  nickname: string
  phone: string
  status: "active" | "disabled"
}

export type ContactUser = {
  avatar: string
  email: string
  id: string
  lastOnlineAt: string | null
  name: string
  nickname: string
  online: boolean
  phone: string
  type: "user"
}

export type ContactApp = {
  avatar: string
  creatorUserId: string | null
  description: string
  id: string
  name: string
  online: boolean
  type: "app"
}

export type ContactGroupAvatarMember = {
  avatar: string
  name: string
  nickname: string
  role: "owner" | "admin" | "member"
}

export type ContactGroup = {
  avatar: string
  avatarMembers: ContactGroupAvatarMember[]
  id: string
  joined: boolean
  memberCount: number
  name: string
  type: "group"
  visibility: "private" | "public"
}

export type ClientContacts = {
  apps: ContactApp[]
  groups: ContactGroup[]
  users: ContactUser[]
}

export type ClientProjectSummary = {
  avatar: string
  description: string
  id: string
  isPersonal: boolean
  name: string
  updatedAt: string
}

export type ClientProjectPage = {
  nextCursor: string | null
  personalProject: ClientProjectSummary
  projects: ClientProjectSummary[]
}

export type ClientConversationProject = {
  avatar: string
  description: string
  id: string
  name: string
}

export type ClientConversationMember = {
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  role: "owner" | "admin" | "member"
  type: "user" | "app"
}

export type ClientConversationTopic = {
  archived: boolean
  parentConversationId: string
  parentConversationName: string
  parentConversationType: "direct" | "group" | "app"
  participating: boolean
  sourceMessageId: string
  sourceMessageSeq: number
  sourceSender: {
    avatar: string
    id: string
    name: string
    type: "user" | "app"
  }
}

export type ClientConversation = {
  avatar: string
  createdAt: string
  id: string
  lastMessageAt: string | null
  lastMessageId: string | null
  lastMessageSeq: number
  lastMessageSummary: string
  lastMentionedSeq: number
  lastReadSeq: number
  memberCount: number
  members?: ClientConversationMember[]
  name: string
  pinned: boolean
  projects?: ClientConversationProject[]
  topic?: ClientConversationTopic
  type: "direct" | "group" | "app" | "topic"
  unreadCount: number
  visibility: "private" | "public"
}

export type ClientMessageSender = {
  id: string
  type: "user" | "app" | "system"
}

export type ClientMessageReplyTo = {
  id: string
  sender: {
    id: string
    name: string
    type: "user" | "app" | "system"
  }
  seq: number
  summary: string
}

export type ClientMessageTopicReply = {
  createdAt: string
  id: string
  sender: {
    id: string
    type: "user" | "app"
  }
  summary: string
}

export type ClientMessageTopic = {
  archived: boolean
  conversationId: string
  recentReplies: ClientMessageTopicReply[]
}

export type ClientMessageReactionUser = {
  id: string
  name: string
}

export type ClientMessageReaction = {
  count: number
  reactedByMe: boolean
  text: string
  users: ClientMessageReactionUser[]
}

export type MessageReactionSnapshot = {
  conversationId: string
  messageId: string
  reactionVersion: number
  reactions: ClientMessageReaction[]
}

export type MessageReactionsUpdatedEvent = {
  actorReacted: boolean
  actorText: string
  actorUserId: string
  conversationId: string
  messageId: string
  reactionVersion: number
  reactions: Omit<ClientMessageReaction, "reactedByMe">[]
}

export type ClientTextMessageBody = {
  content: string
  type: "text"
}

export type ClientMarkdownMessageBody = {
  content: string
  type: "markdown"
}

export type ClientLinkMessageBody = {
  title: string
  type: "link"
  url: string
}

export type ClientCardMessageBody = {
  description: string
  title: string
  type: "card"
  url: string
}

export type ClientChartMessageBody = {
  chartType: "line" | "bar" | "pie" | "radar"
  data: Record<string, unknown>
  description: string
  title: string
  type: "chart"
}

export type ClientFileMessageBody = {
  fileId: string
  name: string
  sizeBytes: number
  type: "file"
}

export type ClientImageMessageBody = {
  fileId: string
  height?: number
  type: "image"
  width?: number
}

export type ClientVoiceMessageBody = {
  contentType: string
  durationMS: number
  fileId: string
  sizeBytes: number
  transcript: string
  type: "voice"
}

export type ClientForwardableMessageBody =
  | ClientTextMessageBody
  | ClientMarkdownMessageBody
  | ClientLinkMessageBody
  | ClientCardMessageBody
  | ClientChartMessageBody
  | ClientFileMessageBody
  | ClientImageMessageBody
  | ClientVoiceMessageBody
  | ClientForwardBundleMessageBody

export type ClientForwardBundleMessageBody = {
  itemCount: number
  items: {
    body: ClientForwardableMessageBody
    senderName: string
    senderType: "user" | "app"
    sentAt: string
    summary: string
  }[]
  type: "forward_bundle"
}

export type ClientSystemEventUserRef = {
  displayName: string
  id: string
}

export type ClientSystemEventMessageBody =
  | {
      event: "group_members_invited"
      invitees: ClientSystemEventUserRef[]
      inviter: ClientSystemEventUserRef
      type: "system_event"
    }
  | {
      actor: ClientSystemEventUserRef
      event:
        | "group_avatar_updated"
        | "group_member_joined"
        | "group_member_left"
        | "message_revoked"
        | "topic_closed"
      type: "system_event"
    }
  | {
      actor: ClientSystemEventUserRef
      event: "group_visibility_changed"
      type: "system_event"
      visibility: "private" | "public"
    }
  | {
      actor: ClientSystemEventUserRef
      event: "group_member_removed"
      target: ClientSystemEventUserRef
      type: "system_event"
    }
  | {
      actor: ClientSystemEventUserRef
      event: "group_name_updated"
      name: string
      type: "system_event"
    }

export type ClientMessageBody =
  | ClientForwardableMessageBody
  | ClientSystemEventMessageBody
  | { type: "revoked" }
  | { type: "unsupported" }

export type ClientMessage = {
  body: ClientMessageBody
  clientMessageId: string
  conversationId: string
  createdAt: string
  delegatedBy?: {
    id: string
    name: string
    type: "user" | "app"
  }
  id: string
  reactionVersion: number
  reactions: ClientMessageReaction[]
  replyTo?: ClientMessageReplyTo
  replyToMessageId?: string
  revokedAt?: string
  revokedByUserId?: string
  sender: ClientMessageSender
  seq: number
  topic?: ClientMessageTopic
}

export type ClientTopicDetail = {
  canArchive: boolean
  canParticipate: boolean
  conversation: ClientConversation
}

export type ClientMessagePage = {
  hasMoreAfter: boolean
  hasMoreBefore: boolean
  limit: number
  newestSeq: number
  oldestSeq: number
}

export type ClientMessageList = {
  messages: ClientMessage[]
  page: ClientMessagePage
}
