export type ClientDataFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type ClientDataSuccessEnvelope<T> = {
  data?: T
  success?: boolean
}

export type ClientDataErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

export type ClientUserResponse = {
  avatar?: string
  created_at?: string
  email?: string
  id?: string
  last_online_at?: string | null
  name?: string
  nickname?: string
  phone?: string
  status?: string
}

export type CurrentClientUserResponse = {
  user?: ClientUserResponse
}

export type UploadCurrentClientAvatarResponse = {
  user?: ClientUserResponse
}

export type UpdateCurrentClientUserInput = {
  avatar?: string
  nickname?: string
}

export type ContactUserResponse = {
  avatar?: string
  email?: string
  id?: string
  last_online_at?: string | null
  name?: string
  nickname?: string
  online?: boolean
  phone?: string
  type?: string
}

export type ListClientContactsResponse = {
  apps?: ContactAppResponse[]
  groups?: ContactGroupResponse[]
  users?: ContactUserResponse[]
}

export type ContactAppResponse = {
  avatar?: string
  creator_user_id?: string | null
  description?: string
  id?: string
  name?: string
  online?: boolean
  type?: string
}

export type ContactGroupResponse = {
  avatar?: string
  avatar_members?: ContactGroupAvatarMemberResponse[]
  id?: string
  joined?: boolean
  member_count?: number
  name?: string
  type?: string
  visibility?: string
}

export type ContactGroupAvatarMemberResponse = {
  avatar?: string
  name?: string
  nickname?: string
  role?: string
}

export type ConversationResponse = {
  avatar?: string
  created_at?: string
  id?: string
  last_message_at?: string | null
  last_message_id?: string | null
  last_message_seq?: number
  last_message_summary?: string
  last_mentioned_seq?: number
  last_read_seq?: number
  member_count?: number
  members?: ConversationMemberResponse[]
  name?: string
  projects?: ConversationProjectResponse[]
  type?: string
  unread_count?: number
  visibility?: string
}

export type ConversationProjectResponse = {
  avatar?: string
  description?: string
  id?: string
  name?: string
}

export type ConversationMemberResponse = {
  avatar?: string
  email?: string
  id?: string
  name?: string
  nickname?: string
  phone?: string
  role?: string
  type?: string
}

export type ListClientConversationsResponse = {
  conversations?: ConversationResponse[]
}

export type CreateDirectConversationResponse = {
  conversation?: ConversationResponse
  created?: boolean
}

export type CreateAppConversationResponse = {
  conversation?: ConversationResponse
  created?: boolean
}

export type CreateGroupConversationResponse = {
  conversation?: ConversationResponse
}

export type AddGroupConversationMembersResponse = {
  conversation?: ConversationResponse
  message?: MessageResponse | null
}

export type GroupConversationActionResponse = {
  conversation?: ConversationResponse
  message?: MessageResponse | null
}

export type LeaveGroupConversationResponse = {
  conversation_id?: string
  message?: MessageResponse
}

export type DissolveGroupConversationResponse = {
  conversation_id?: string
}

export type UploadGroupConversationAvatarResponse = {
  conversation?: ConversationResponse
  message?: MessageResponse
}

export type MessageSenderResponse = {
  id?: string
  type?: string
}

export type MessageDelegatedByResponse = {
  id?: string
  name?: string
  type?: string
}

export type MessageReplyToSenderResponse = {
  id?: string
  name?: string
  type?: string
}

export type MessageReplyToResponse = {
  id?: string
  sender?: MessageReplyToSenderResponse
  seq?: number
  summary?: string
}

export type TextMessageBodyResponse = {
  content?: string
  type?: "text"
}

export type MarkdownMessageBodyResponse = {
  content?: string
  type?: "markdown"
}

export type LinkMessageBodyResponse = {
  title?: string
  type?: "link"
  url?: string
}

export type CardMessageBodyResponse = {
  description?: string
  title?: string
  type?: "card"
  url?: string
}

export type ChartMessageBodyResponse = {
  chart_type?: string
  data?: unknown
  description?: string
  title?: string
  type?: "chart"
}

export type FileMessageBodyResponse = {
  file_id?: string
  name?: string
  size_bytes?: number
  type?: "file"
}

export type ImageMessageBodyResponse = {
  file_id?: string
  height?: number
  type?: "image"
  width?: number
}

export type VoiceMessageBodyResponse = {
  content_type?: string
  duration_ms?: number
  file_id?: string
  size_bytes?: number
  transcript?: string
  type?: "voice"
}

export type ForwardBundleItemBodyResponse =
  | TextMessageBodyResponse
  | MarkdownMessageBodyResponse
  | LinkMessageBodyResponse
  | CardMessageBodyResponse
  | ChartMessageBodyResponse
  | FileMessageBodyResponse
  | ImageMessageBodyResponse
  | VoiceMessageBodyResponse
  | ForwardBundleMessageBodyResponse

export type ForwardBundleItemResponse = {
  body?: ForwardBundleItemBodyResponse
  sender_name?: string
  sender_type?: string
  sent_at?: string
  summary?: string
}

export type ForwardBundleMessageBodyResponse = {
  item_count?: number
  items?: ForwardBundleItemResponse[]
  type?: "forward_bundle"
}

export type SystemEventUserRefResponse = {
  display_name?: string
  id?: string
}

export type GroupMembersInvitedSystemEventBodyResponse = {
  event?: "group_members_invited"
  invitees?: SystemEventUserRefResponse[]
  inviter?: SystemEventUserRefResponse
  type?: "system_event"
}

export type GroupAvatarUpdatedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_avatar_updated"
  type?: "system_event"
}

export type GroupVisibilityChangedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_visibility_changed"
  type?: "system_event"
  visibility?: string
}

export type GroupMemberJoinedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_member_joined"
  type?: "system_event"
}

export type GroupMemberLeftSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_member_left"
  type?: "system_event"
}

export type GroupMemberRemovedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_member_removed"
  target?: SystemEventUserRefResponse
  type?: "system_event"
}

export type GroupNameUpdatedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "group_name_updated"
  name?: string
  type?: "system_event"
}

export type MessageRevokedSystemEventBodyResponse = {
  actor?: SystemEventUserRefResponse
  event?: "message_revoked"
  type?: "system_event"
}

export type MessageBodyResponse =
  | TextMessageBodyResponse
  | MarkdownMessageBodyResponse
  | LinkMessageBodyResponse
  | CardMessageBodyResponse
  | ChartMessageBodyResponse
  | FileMessageBodyResponse
  | ImageMessageBodyResponse
  | VoiceMessageBodyResponse
  | ForwardBundleMessageBodyResponse
  | GroupMembersInvitedSystemEventBodyResponse
  | GroupAvatarUpdatedSystemEventBodyResponse
  | GroupVisibilityChangedSystemEventBodyResponse
  | GroupMemberJoinedSystemEventBodyResponse
  | GroupMemberLeftSystemEventBodyResponse
  | GroupMemberRemovedSystemEventBodyResponse
  | GroupNameUpdatedSystemEventBodyResponse
  | MessageRevokedSystemEventBodyResponse

export type MessageResponse = {
  body?: MessageBodyResponse
  client_message_id?: string
  conversation_id?: string
  created_at?: string
  delegated_by?: MessageDelegatedByResponse | null
  id?: string
  reply_to?: MessageReplyToResponse | null
  reply_to_message_id?: string
  revoked_at?: string
  revoked_by_user_id?: string
  sender?: MessageSenderResponse
  seq?: number
}

export type MessagePageResponse = {
  has_more_after?: boolean
  has_more_before?: boolean
  limit?: number
  newest_seq?: number
  oldest_seq?: number
}

export type ListConversationMessagesResponse = {
  messages?: MessageResponse[]
  page?: MessagePageResponse
}

export type CreateMessageResponse = {
  message?: MessageResponse
}

export type ForwardMessagesTargetErrorResponse = {
  code?: string
  message?: string
}

export type ForwardMessagesTargetResultResponse = {
  conversation_id?: string
  error?: ForwardMessagesTargetErrorResponse | null
  messages?: MessageResponse[]
  status?: string
}

export type ForwardConversationMessagesResponse = {
  failed_count?: number
  results?: ForwardMessagesTargetResultResponse[]
  sent_count?: number
}

export type RevokeConversationMessageResponse = {
  message?: MessageResponse
  system_message?: MessageResponse
}

export type MarkConversationReadResponse = {
  conversation_id?: string
  last_read_seq?: number
  unread_count?: number
}

export type MessageCreatedEventPayloadResponse = {
  message?: MessageResponse
}

export type MessageUpdatedEventPayloadResponse = {
  message?: MessageResponse
}

export type ConversationRemovedEventPayloadResponse = {
  conversation_id?: string
}

export type ConversationMemberMentionedEventPayloadResponse = {
  conversation_id?: string
  last_mentioned_seq?: number
}

export type TemporaryFileReadURLResponse = {
  expires_at?: string
  file_id?: string
  url?: string
}

export type ReadTemporaryFileURLsResponse = {
  urls?: TemporaryFileReadURLResponse[]
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

export type ContactGroupAvatarMember = {
  avatar: string
  name: string
  nickname: string
  role: "owner" | "admin" | "member"
}

export type ClientContacts = {
  apps: ContactApp[]
  groups: ContactGroup[]
  users: ContactUser[]
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
  projects?: ClientConversationProject[]
  type: "direct" | "group" | "app"
  unreadCount: number
  visibility: "private" | "public"
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

export type ClientMessageSender = {
  id: string
  type: "user" | "app" | "system"
}

export type ClientMessageDelegatedBy = {
  id: string
  name: string
  type: "user" | "app"
}

export type ClientMessageReplyToSender = {
  id: string
  name: string
  type: "user" | "app" | "system"
}

export type ClientMessageReplyTo = {
  id: string
  sender: ClientMessageReplyToSender
  seq: number
  summary: string
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

export type ClientChartSeries = {
  name: string
  values: Array<number | null>
}

export type ClientLineChartMessageBody = {
  chartType: "line"
  data: {
    labels: string[]
    series: ClientChartSeries[]
  }
  description: string
  title: string
  type: "chart"
}

export type ClientBarChartMessageBody = {
  chartType: "bar"
  data: {
    direction: "horizontal" | "vertical"
    labels: string[]
    mode: "grouped" | "stacked"
    series: ClientChartSeries[]
  }
  description: string
  title: string
  type: "chart"
}

export type ClientPieChartMessageBody = {
  chartType: "pie"
  data: {
    items: Array<{
      name: string
      value: number
    }>
  }
  description: string
  title: string
  type: "chart"
}

export type ClientRadarChartMessageBody = {
  chartType: "radar"
  data: {
    axes: Array<{
      max: number
      name: string
    }>
    series: Array<{
      name: string
      values: number[]
    }>
  }
  description: string
  title: string
  type: "chart"
}

export type ClientChartMessageBody =
  | ClientLineChartMessageBody
  | ClientBarChartMessageBody
  | ClientPieChartMessageBody
  | ClientRadarChartMessageBody

export type ClientEntityCardType = "user" | "app" | "group" | "project" | "task"

export type ClientEntityCardMessageInput = {
  entityId: string
  entityType: ClientEntityCardType
  type: "entity_card"
}

export type ClientCardSendInput =
  ClientCardMessageBody | ClientEntityCardMessageInput

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

export type ClientForwardBundleItem = {
  body: ClientForwardableMessageBody
  senderName: string
  senderType: "user" | "app"
  sentAt: string
  summary: string
}

export type ClientForwardBundleMessageBody = {
  itemCount: number
  items: ClientForwardBundleItem[]
  type: "forward_bundle"
}

export type ClientRevokedMessageBody = {
  type: "revoked"
}

export type ClientUnsupportedMessageBody = {
  type: "unsupported"
}

export type ClientSystemEventUserRef = {
  displayName: string
  id: string
}

export type ClientGroupMembersInvitedSystemEventBody = {
  event: "group_members_invited"
  invitees: ClientSystemEventUserRef[]
  inviter: ClientSystemEventUserRef
  type: "system_event"
}

export type ClientGroupAvatarUpdatedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_avatar_updated"
  type: "system_event"
}

export type ClientGroupVisibilityChangedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_visibility_changed"
  type: "system_event"
  visibility: "private" | "public"
}

export type ClientGroupMemberJoinedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_member_joined"
  type: "system_event"
}

export type ClientGroupMemberLeftSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_member_left"
  type: "system_event"
}

export type ClientGroupMemberRemovedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_member_removed"
  target: ClientSystemEventUserRef
  type: "system_event"
}

export type ClientGroupNameUpdatedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "group_name_updated"
  name: string
  type: "system_event"
}

export type ClientMessageRevokedSystemEventBody = {
  actor: ClientSystemEventUserRef
  event: "message_revoked"
  type: "system_event"
}

export type ClientMessageBody =
  | ClientTextMessageBody
  | ClientMarkdownMessageBody
  | ClientLinkMessageBody
  | ClientCardMessageBody
  | ClientChartMessageBody
  | ClientFileMessageBody
  | ClientImageMessageBody
  | ClientVoiceMessageBody
  | ClientForwardBundleMessageBody
  | ClientRevokedMessageBody
  | ClientUnsupportedMessageBody
  | ClientGroupMembersInvitedSystemEventBody
  | ClientGroupAvatarUpdatedSystemEventBody
  | ClientGroupVisibilityChangedSystemEventBody
  | ClientGroupMemberJoinedSystemEventBody
  | ClientGroupMemberLeftSystemEventBody
  | ClientGroupMemberRemovedSystemEventBody
  | ClientGroupNameUpdatedSystemEventBody
  | ClientMessageRevokedSystemEventBody

export type ClientMessage = {
  body: ClientMessageBody
  clientMessageId: string
  conversationId: string
  createdAt: string
  delegatedBy?: ClientMessageDelegatedBy
  id: string
  replyTo?: ClientMessageReplyTo
  replyToMessageId?: string
  revokedAt?: string
  revokedByUserId?: string
  sender: ClientMessageSender
  seq: number
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

export type ListConversationMessagesOptions = {
  afterSeq?: number
  beforeSeq?: number
  limit?: number
}

export type SendConversationTextMessageInput = {
  clientMessageId: string
  content: string
  replyToMessageId?: string
}

export type SendConversationMarkdownMessageInput = {
  clientMessageId: string
  content: string
  replyToMessageId?: string
}

export type SendConversationLinkMessageInput = {
  clientMessageId: string
  replyToMessageId?: string
  url: string
}

export type SendConversationCardMessageInput = {
  clientMessageId: string
  description: string
  replyToMessageId?: string
  title: string
  url: string
}

export type SendConversationChartMessageInput = {
  chart: ClientChartMessageBody
  clientMessageId: string
  replyToMessageId?: string
}

export type SendConversationEntityCardMessageInput = {
  clientMessageId: string
  entityId: string
  entityType: ClientEntityCardType
  replyToMessageId?: string
}

export type SendConversationFileMessageInput = {
  clientMessageId: string
  file: File
  replyToMessageId?: string
}

export type SendConversationImageMessageInput = {
  clientMessageId: string
  image: File
  replyToMessageId?: string
}

export type SendConversationVoiceMessageInput = {
  clientMessageId: string
  durationMS: number
  replyToMessageId?: string
  voice: Blob
}

export type ForwardConversationMessagesInput = {
  clientForwardId: string
  messageIds: string[]
  mode: "separate" | "merged"
  targetConversationIds: string[]
}

export type ForwardConversationMessagesTargetResult = {
  conversationId: string
  error?: {
    code: string
    message: string
  }
  messages: ClientMessage[]
  status: "sent" | "failed"
}

export type ForwardConversationMessagesResult = {
  failedCount: number
  results: ForwardConversationMessagesTargetResult[]
  sentCount: number
}

export type TemporaryFileReadURL = {
  expiresAt: string
  fileId: string
  url: string
}

export type MarkConversationReadOptions = {
  upToSeq?: number
}

export type MarkConversationReadResult = {
  conversationId: string
  lastReadSeq: number
  unreadCount: number
}

export type CreateGroupConversationInput = {
  appIds?: string[]
  memberIds: string[]
  name: string
}

export type AddGroupConversationMembersInput = {
  appIds?: string[]
  memberIds?: string[]
}

export type UpdateGroupConversationNameInput = {
  name: string
}

export type AddGroupConversationMembersResult = {
  conversation: ClientConversation
  message: ClientMessage | null
}

export type GroupConversationActionResult = {
  conversation: ClientConversation
  message: ClientMessage | null
}

export type UploadGroupConversationAvatarResult = {
  conversation: ClientConversation
  message: ClientMessage
}

export type LeaveGroupConversationResult = {
  conversationId: string
  message: ClientMessage
}

export type DissolveGroupConversationResult = {
  conversationId: string
}
