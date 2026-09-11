import { createContext, useContext, useEffect, useMemo } from "react"

import {
  type ClientConversation,
  type ClientDataRequestError,
  type ImageCaptionType,
  type MarkConversationReadOptions,
  type ClientMessage,
  type MessageReactionsUpdatedEvent,
  type MessageChoiceUpdatedEvent,
  type MessageReactionSnapshot,
  type ClientMessageTopic,
  type ClientCardSendInput,
  type ClientMessagePage,
  type ClientUser,
  type ContactApp,
  type ContactGroup,
  type ContactUser,
  type ContactDirectoryMode,
  type FriendRequest,
} from "@/lib/client-data-api"
import type {
  ClientProjectDetail,
  ClientProjectSummary,
} from "@/lib/project-data-api"
import type { VoiceMessageRecording } from "@/lib/voice-message"

export type ClientConversationMessageState = {
  error: string | null
  focus: ClientConversationMessageFocus | null
  loaded: boolean
  loading: boolean
  loadingAfter: boolean
  loadingBefore: boolean
  latestKnownSeq: number
  messages: ClientMessage[]
  page: ClientMessagePage | null
  pendingLatestMessageCount: number
  sending: boolean
  viewMode: "latest" | "history"
}

export type ClientConversationMessageFocus = {
  messageId: string
  requestKey: number
}

export type SendConversationMessageOptions = {
  replyToMessageId?: string
}

export type SendConversationImageOptions = SendConversationMessageOptions & {
  caption?: string
  captionType?: ImageCaptionType
}

export type SendConversationVideoOptions = SendConversationMessageOptions & {
  caption?: string
  captionType?: ImageCaptionType
}

export type ClientDataContextValue = {
  contactApps: ContactApp[]
  contactGroups: ContactGroup[]
  conversations: ClientConversation[]
  contacts: ContactUser[]
  contactDirectoryMode: ContactDirectoryMode
  incomingFriendRequests: FriendRequest[]
  outgoingFriendRequests: FriendRequest[]
  usersById: Readonly<Record<string, ContactUser>>
  contactsError: ClientDataRequestError | null
  contactsLoading: boolean
  contactsRefreshing: boolean
  foregroundConversationId?: string
  me: ClientUser
  meError: ClientDataRequestError | null
  meLoading: boolean
  meRefreshing: boolean
  personalProject: ClientProjectSummary
  projects: ClientProjectSummary[]
  projectsError: ClientDataRequestError | null
  projectsLoading: boolean
  projectsLoadingMore: boolean
  projectsNextCursor: string | null
  projectsRefreshing: boolean
  addGroupConversationMembers: (
    conversationId: string,
    memberIds: string[],
    appIds?: string[]
  ) => Promise<ClientConversation>
  createGroupConversation: (
    name: string,
    memberIds: string[],
    appIds?: string[]
  ) => Promise<ClientConversation>
  createFriendRequest: (userId: string) => Promise<void>
  acceptFriendRequest: (requestId: string) => Promise<void>
  rejectFriendRequest: (requestId: string) => Promise<void>
  cancelFriendRequest: (requestId: string) => Promise<void>
  deleteFriend: (userId: string) => Promise<void>
  createProject: (
    name: string,
    groupIds?: string[]
  ) => Promise<ClientProjectDetail>
  dissolveGroupConversation: (conversationId: string) => Promise<void>
  dismissConversation: (conversationId: string) => Promise<void>
  compactConversationMessages: (conversationId: string) => void
  registerConversationMessageView: (conversationId: string) => () => void
  ensureConversationMessages: (conversationId: string) => void
  focusConversationMessage: (
    conversationId: string,
    target: { messageId: string; seq: number }
  ) => Promise<void>
  consumeConversationMessageFocus: (
    conversationId: string,
    requestKey: number
  ) => void
  getConversation: (conversationId: string) => ClientConversation | null
  getUser: (userId: string) => ContactUser | undefined
  ensureUsers: (userIds: string[]) => Promise<void>
  invalidateUsers: (userIds: string[], updatedAt?: string) => void
  updateUserPresence: (
    userId: string,
    online: boolean,
    lastOnlineAt?: string | null
  ) => void
  getConversationMessageState: (
    conversationId: string
  ) => ClientConversationMessageState
  getLatestCachedMessage?: (conversationId: string) => ClientMessage | undefined
  loadBeforeConversationMessages: (conversationId: string) => void
  loadAfterConversationMessages: (conversationId: string) => void
  returnToLatestConversationMessages: (conversationId: string) => void
  markConversationRead: (
    conversationId: string,
    options?: MarkConversationReadOptions
  ) => Promise<void>
  setConversationPinned: (
    conversationId: string,
    pinned: boolean
  ) => Promise<void>
  setConversationMuted: (
    conversationId: string,
    muted: boolean
  ) => Promise<void>
  handleIncomingConversationMessage: (
    message: ClientMessage,
    options?: { activeConversationId?: string; visible?: boolean }
  ) => void
  handleIncomingConversationMessageUpdate: (message: ClientMessage) => void
  handleIncomingMessageReactionsUpdate: (
    event: MessageReactionsUpdatedEvent
  ) => void
  handleIncomingMessageChoiceUpdate: (event: MessageChoiceUpdatedEvent) => void
  respondToChoice: (
    conversationId: string,
    messageId: string,
    optionIds: string[]
  ) => Promise<void>
  updateConversationLastChoiceSeq: (
    conversationId: string,
    lastChoiceSeq: number
  ) => void
  updateConversationLastMentionedSeq: (
    conversationId: string,
    lastMentionedSeq: number
  ) => void
  updateMessageTopic?: (
    parentConversationId: string,
    sourceMessageId: string,
    topic: Pick<ClientMessageTopic, "archived" | "conversationId">
  ) => void
  mergeIncomingConversationMessage: (
    message: ClientMessage,
    options?: { markLoaded?: boolean; updateList?: boolean }
  ) => void
  openDirectConversation: (userId: string) => Promise<ClientConversation>
  openAppConversation: (appId: string) => Promise<ClientConversation>
  restoreConversation: (conversationId: string) => Promise<ClientConversation>
  joinGroupConversation: (conversationId: string) => Promise<ClientConversation>
  leaveGroupConversation: (conversationId: string) => Promise<void>
  removeConversation: (conversationId: string) => void
  removeGroupConversationMember: (
    conversationId: string,
    memberId: string,
    memberType?: "user" | "app"
  ) => Promise<ClientConversation>
  revokeConversationMessage: (
    conversationId: string,
    messageId: string
  ) => Promise<void>
  setMessageReaction: (
    conversationId: string,
    messageId: string,
    text: string,
    reacted: boolean
  ) => Promise<MessageReactionSnapshot>
  setGroupConversationPublic: (
    conversationId: string
  ) => Promise<ClientConversation>
  setGroupConversationPrivate: (
    conversationId: string
  ) => Promise<ClientConversation>
  updateGroupConversationName: (
    conversationId: string,
    name: string
  ) => Promise<ClientConversation>
  updateGroupConversationAnnouncement: (
    conversationId: string,
    announcement: string
  ) => Promise<ClientConversation>
  refreshConversations: () => Promise<void>
  refreshRestoredConversation: (conversationId: string) => Promise<void>
  refreshContacts: () => Promise<void>
  refreshFriendRequests: () => Promise<void>
  refreshMe: () => Promise<void>
  refreshProjects: () => Promise<void>
  loadMoreProjects: () => Promise<void>
  sendConversationText: (
    conversationId: string,
    content: string,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  sendConversationMarkdown: (
    conversationId: string,
    content: string,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  sendConversationLink: (
    conversationId: string,
    url: string,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  sendConversationCard: (
    conversationId: string,
    card: ClientCardSendInput,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  sendConversationFile: (
    conversationId: string,
    file: File,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  sendConversationImage: (
    conversationId: string,
    image: File,
    options?: SendConversationImageOptions
  ) => Promise<ClientMessage | null>
  sendConversationVideo: (
    conversationId: string,
    video: File,
    options?: SendConversationVideoOptions
  ) => Promise<ClientMessage | null>
  sendConversationVoice: (
    conversationId: string,
    voice: VoiceMessageRecording,
    options?: SendConversationMessageOptions
  ) => Promise<ClientMessage | null>
  setForegroundConversationId?: (conversationId: string) => void
  syncLoadedConversationMessages: () => void
  updateConversationLastMessage: (message: ClientMessage) => void
  updateConversationPinned: (conversationId: string, pinned: boolean) => void
  updateConversationMuted: (conversationId: string, muted: boolean) => void
  updateGroupConversationAvatar: (
    conversationId: string,
    file: File
  ) => Promise<ClientConversation>
}

export const ClientDataContext = createContext<ClientDataContextValue | null>(
  null
)

export function useClientUser(userId: string) {
  const { ensureUsers, usersById } = useClientData()
  useEffect(() => {
    if (userId) void ensureUsers([userId]).catch(() => undefined)
  }, [ensureUsers, userId])
  return usersById[userId]
}

export function useClientUsers(userIds: string[]) {
  const { ensureUsers, usersById } = useClientData()
  const key = Array.from(new Set(userIds.filter(Boolean)))
    .sort()
    .join("\u0000")
  useEffect(() => {
    const ids = key ? key.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [ensureUsers, key])
  return useMemo(
    () => new Map(userIds.map((id) => [id, usersById[id]])),
    [userIds, usersById]
  )
}

export function useOptionalClientData() {
  return useContext(ClientDataContext)
}

export function useClientData() {
  const context = useOptionalClientData()

  if (!context) {
    throw new Error("useClientData must be used within ClientDataProvider")
  }

  return context
}
