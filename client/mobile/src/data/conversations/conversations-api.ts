import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"
import {
  normalizeClientMessage,
  normalizeClientMessageBody,
  normalizeClientMessageReply,
} from "@/data/messages/message-normalizer"
import type {
  ClientConversation,
  ClientConversationMember,
  ClientConversationProject,
  ClientTopicDetail,
} from "@/core/models"

type ConversationProjectResponse = {
  avatar?: string
  description?: string
  id?: string
  name?: string
}

type ConversationMemberResponse = {
  avatar?: string
  email?: string
  id?: string
  name?: string
  nickname?: string
  phone?: string
  role?: string
  type?: string
}

type ConversationTopicResponse = {
  archived?: boolean
  parent_conversation_id?: string
  parent_conversation_name?: string
  parent_conversation_type?: string
  participating?: boolean
  source_message_id?: string
  source_message_seq?: number
  source_sender?: {
    avatar?: string
    id?: string
    name?: string
    type?: string
  }
}

type ConversationLastMessageSenderResponse = {
  id?: string
  name?: string
  nickname?: string
  type?: string
}

type ConversationResponse = {
  announcement?: string
  avatar?: string
  can_send?: boolean
  created_at?: string
  id?: string
  last_message_at?: string | null
  last_message_id?: string | null
  last_message_seq?: number
  last_message_sender?: ConversationLastMessageSenderResponse | null
  last_message_summary?: string
  last_choice_seq?: number
  last_mentioned_seq?: number
  last_read_seq?: number
  member_count?: number
  members?: ConversationMemberResponse[]
  name?: string
  notification_muted?: boolean
  pinned?: boolean
  projects?: ConversationProjectResponse[]
  topic?: ConversationTopicResponse | null
  type?: string
  unread_count?: number
  visibility?: string
}

type ConversationsResponse = {
  conversations?: ConversationResponse[]
}

type ConversationActionResponse = {
  conversation?: ConversationResponse
}

type ConversationCreateTopicResponse = ConversationActionResponse & {
  created?: boolean
}

type ConversationPinResponse = {
  conversation_id?: string
  pinned?: boolean
}

type ConversationMuteResponse = {
  conversation_id?: string
  muted?: boolean
}

type ConversationDismissResponse = {
  conversation_id?: string
}

type GroupConversationActionResponse = {
  conversation_id?: string
}

type ConversationTopicDetailResponse = {
  can_archive?: boolean
  can_participate?: boolean
  conversation?: ConversationResponse
  parent_conversation?: {
    id?: string
    name?: string
    type?: string
  }
  source_message?: {
    body?: unknown
    created_at?: string
    id?: string
    reply_to?: unknown
    revoked_at?: string | null
    sender?: {
      avatar?: string
      id?: string
      name?: string
      type?: string
    }
    seq?: number
    summary?: string
  }
}

type ConversationRequestOptions = {
  fetcher?: ApiFetch
  signal?: AbortSignal
}

export async function fetchConversations(
  target: AuthenticatedTarget,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationsResponse
  >("/api/client/conversations", {
    errorMessage: "加载会话列表失败",
    method: "GET",
    signal: options.signal,
  })

  if (!data || !Array.isArray(data.conversations)) {
    throw new ApiRequestError("会话列表响应格式不正确")
  }

  return data.conversations.map(normalizeConversation)
}

export async function restoreConversation(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(`/api/client/conversations/${encodeURIComponent(conversationId)}/restore`, {
    errorMessage: "恢复会话失败",
    method: "POST",
    signal: options.signal,
  })

  return normalizeConversationAction(data, "恢复会话响应格式不正确")
}

export async function setConversationPinned(
  target: AuthenticatedTarget,
  conversationId: string,
  pinned: boolean,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationPinResponse
  >(`/api/client/conversations/${encodeURIComponent(conversationId)}/pin`, {
    errorMessage: pinned ? "置顶会话失败" : "取消置顶失败",
    method: pinned ? "PUT" : "DELETE",
    signal: options.signal,
  })

  if (
    !data?.conversation_id?.trim() ||
    typeof data.pinned !== "boolean"
  ) {
    throw new ApiRequestError("会话置顶响应格式不正确")
  }

  return {
    conversationId: data.conversation_id,
    pinned: data.pinned,
  }
}

export async function setConversationMuted(
  target: AuthenticatedTarget,
  conversationId: string,
  muted: boolean,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationMuteResponse
  >(`/api/client/conversations/${encodeURIComponent(conversationId)}/mute`, {
    errorMessage: muted ? "开启消息免打扰失败" : "取消消息免打扰失败",
    method: muted ? "PUT" : "DELETE",
    signal: options.signal,
  })

  if (!data?.conversation_id?.trim() || typeof data.muted !== "boolean") {
    throw new ApiRequestError("会话免打扰响应格式不正确")
  }

  return {
    conversationId: data.conversation_id,
    muted: data.muted,
  }
}

export async function dismissConversation(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationDismissResponse
  >(`/api/client/conversations/${encodeURIComponent(conversationId)}`, {
    errorMessage: "删除对话失败",
    method: "DELETE",
    signal: options.signal,
  })

  if (!data?.conversation_id?.trim()) {
    throw new ApiRequestError("删除对话响应格式不正确")
  }

  return { conversationId: data.conversation_id }
}

export async function leaveGroupConversation(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    GroupConversationActionResponse
  >(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/leave`,
    {
      errorMessage: "退出群聊失败",
      method: "POST",
      signal: options.signal,
    }
  )

  if (!data?.conversation_id?.trim()) {
    throw new ApiRequestError("退出群聊响应格式不正确")
  }

  return { conversationId: data.conversation_id }
}

export async function dissolveGroupConversation(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    GroupConversationActionResponse
  >(`/api/client/conversations/groups/${encodeURIComponent(conversationId)}`, {
    errorMessage: "解散群聊失败",
    method: "DELETE",
    signal: options.signal,
  })

  if (!data?.conversation_id?.trim()) {
    throw new ApiRequestError("解散群聊响应格式不正确")
  }

  return { conversationId: data.conversation_id }
}

export async function addGroupConversationMembers(
  target: AuthenticatedTarget,
  conversationId: string,
  memberIds: string[],
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/members`,
    {
      body: JSON.stringify({ app_ids: [], member_ids: memberIds }),
      errorMessage: "添加群成员失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    }
  )

  return normalizeConversationAction(data, "添加群成员响应格式不正确")
}

export async function createGroupConversation(
  target: AuthenticatedTarget,
  memberIds: string[],
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >("/api/client/conversations/groups", {
    body: JSON.stringify({
      app_ids: [],
      member_ids: memberIds,
      name: "新建群聊",
    }),
    errorMessage: "创建群聊失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  return normalizeConversationAction(data, "创建群聊响应格式不正确")
}

export async function updateGroupConversationName(
  target: AuthenticatedTarget,
  conversationId: string,
  name: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/name`,
    {
      body: JSON.stringify({ name }),
      errorMessage: "修改群聊名称失败",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      signal: options.signal,
    }
  )

  return normalizeConversationAction(data, "修改群聊名称响应格式不正确")
}

export async function updateGroupConversationAnnouncement(
  target: AuthenticatedTarget,
  conversationId: string,
  announcement: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/announcement`,
    {
      body: JSON.stringify({ announcement }),
      errorMessage: "修改群公告失败",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      signal: options.signal,
    }
  )

  return normalizeConversationAction(data, "修改群公告响应格式不正确")
}

export async function openDirectConversation(
  target: AuthenticatedTarget,
  userId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >("/api/client/conversations/direct", {
    body: JSON.stringify({ user_id: userId }),
    errorMessage: "创建一对一会话失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  return normalizeConversationAction(data, "创建一对一会话响应格式不正确")
}

export async function openAppConversation(
  target: AuthenticatedTarget,
  appId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >("/api/client/conversations/apps", {
    body: JSON.stringify({ app_id: appId }),
    errorMessage: "创建应用会话失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  return normalizeConversationAction(data, "创建应用会话响应格式不正确")
}

export async function joinGroupConversation(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(
    `/api/client/conversations/groups/${encodeURIComponent(conversationId)}/join`,
    {
      errorMessage: "加入群聊失败",
      method: "POST",
      signal: options.signal,
    }
  )

  return normalizeConversationAction(data, "加入群聊响应格式不正确")
}

export async function fetchConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
): Promise<ClientTopicDetail> {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationTopicDetailResponse
  >(`/api/client/conversations/topics/${encodeURIComponent(conversationId)}`, {
    errorMessage: "加载话题失败",
    method: "GET",
    signal: options.signal,
  })

  const parent = data?.parent_conversation
  const source = data?.source_message
  const senderType = source?.sender?.type
  if (
    !data?.conversation ||
    !parent?.id ||
    !parent.name ||
    !source?.created_at ||
    !source.id ||
    !source.sender?.id ||
    (senderType !== "user" && senderType !== "app") ||
    typeof source.seq !== "number" ||
    typeof source.summary !== "string"
  ) {
    throw new ApiRequestError("话题详情响应格式不正确")
  }

  let sourceReply = normalizeClientMessageReply(source.reply_to)
  if (!sourceReply && !source.revoked_at) {
    const sourcePage = await createProtectedApiClient(target, options.fetcher).request<{
      messages?: unknown[]
    }>(
      `/api/client/conversations/${encodeURIComponent(parent.id)}/messages?before_seq=${source.seq + 1}&limit=1`,
      {
        errorMessage: "加载话题来源消息失败",
        method: "GET",
        signal: options.signal,
      }
    )
    if (!Array.isArray(sourcePage?.messages)) {
      throw new ApiRequestError("消息列表响应格式不正确")
    }
    sourceReply = sourcePage.messages
      .map(normalizeClientMessage)
      .find((message) => message.id === source.id)?.replyTo
  }

  return {
    canArchive: Boolean(data.can_archive),
    canParticipate: Boolean(data.can_participate),
    conversation: normalizeConversation(data.conversation),
    parentConversation: {
      id: parent.id,
      name: parent.name,
      type: normalizeParentConversationType(parent.type),
    },
    sourceMessage: {
      body: source.revoked_at
        ? { type: "revoked" }
        : normalizeClientMessageBody(source.body),
      createdAt: source.created_at,
      id: source.id,
      replyTo: sourceReply,
      revokedAt: source.revoked_at ?? null,
      sender: {
        avatar: source.sender.avatar ?? "",
        id: source.sender.id,
        name: source.sender.name ?? "",
        type: senderType,
      },
      seq: source.seq,
      summary: source.summary,
    },
  }
}

export async function createConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationCreateTopicResponse
  >(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/topic`,
    {
      errorMessage: "创建话题失败",
      method: "POST",
      signal: options.signal,
    }
  )

  return {
    conversation: normalizeConversationAction(
      data,
      "创建话题响应格式不正确"
    ),
    created: Boolean(data?.created),
  }
}

export async function archiveConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ConversationActionResponse
  >(
    `/api/client/conversations/topics/${encodeURIComponent(conversationId)}/archive`,
    {
      errorMessage: "关闭话题失败",
      method: "POST",
      signal: options.signal,
    }
  )

  return normalizeConversationAction(data, "关闭话题响应格式不正确")
}

function normalizeConversationAction(
  data: ConversationActionResponse | undefined,
  errorMessage: string
) {
  if (!data?.conversation) {
    throw new ApiRequestError(errorMessage)
  }

  return normalizeConversation(data.conversation)
}

function normalizeConversation(
  conversation: ConversationResponse
): ClientConversation {
  if (!conversation.created_at || !conversation.id || !conversation.name) {
    throw new ApiRequestError("会话列表响应格式不正确")
  }

  const normalized: ClientConversation = {
    announcement: conversation.announcement?.trim() ?? "",
    avatar: conversation.avatar ?? "",
    canSend: conversation.can_send !== false,
    createdAt: conversation.created_at,
    id: conversation.id,
    lastMessageAt: conversation.last_message_at ?? null,
    lastMessageId: conversation.last_message_id ?? null,
    lastMessageSeq: conversation.last_message_seq ?? 0,
    lastMessageSender: normalizeConversationLastMessageSender(
      conversation.last_message_sender
    ),
    lastMessageSummary: conversation.last_message_summary ?? "",
    lastChoiceSeq: conversation.last_choice_seq ?? 0,
    lastMentionedSeq: conversation.last_mentioned_seq ?? 0,
    lastReadSeq: conversation.last_read_seq ?? 0,
    memberCount: conversation.member_count ?? 0,
    name: conversation.name,
    notificationMuted: Boolean(conversation.notification_muted),
    pinned: Boolean(conversation.pinned),
    type: normalizeConversationType(conversation.type),
    unreadCount: conversation.unread_count ?? 0,
    visibility: conversation.visibility === "public" ? "public" : "private",
  }

  if (conversation.members) {
    normalized.members = conversation.members.map(normalizeConversationMember)
  }

  if (conversation.projects) {
    normalized.projects = conversation.projects.map(
      normalizeConversationProject
    )
  }

  if (conversation.topic) {
    normalized.topic = normalizeConversationTopic(conversation.topic)
  }

  return normalized
}

function normalizeConversationLastMessageSender(
  sender: ConversationResponse["last_message_sender"]
): ClientConversation["lastMessageSender"] {
  if (!sender) {
    return null
  }

  return {
    id: sender.id ?? "",
    name: sender.name ?? "",
    nickname: sender.nickname ?? "",
    type:
      sender.type === "app" || sender.type === "system" ? sender.type : "user",
  }
}

function normalizeConversationTopic(
  topic: ConversationTopicResponse
): NonNullable<ClientConversation["topic"]> {
  const sourceSender = topic.source_sender
  if (
    !topic.parent_conversation_id ||
    !topic.parent_conversation_name ||
    !topic.source_message_id ||
    typeof topic.source_message_seq !== "number" ||
    !sourceSender?.id ||
    (sourceSender.type !== "user" && sourceSender.type !== "app")
  ) {
    throw new ApiRequestError("会话话题信息响应格式不正确")
  }

  return {
    archived: Boolean(topic.archived),
    parentConversationId: topic.parent_conversation_id,
    parentConversationName: topic.parent_conversation_name,
    parentConversationType: normalizeParentConversationType(
      topic.parent_conversation_type
    ),
    participating: Boolean(topic.participating),
    sourceMessageId: topic.source_message_id,
    sourceMessageSeq: topic.source_message_seq,
    sourceSender: {
      avatar: sourceSender.avatar ?? "",
      id: sourceSender.id,
      name: sourceSender.name ?? "",
      type: sourceSender.type,
    },
  }
}

function normalizeConversationMember(
  member: ConversationMemberResponse
): ClientConversationMember {
  const type = member.type === "app" ? "app" : "user"

  if (!member.id || (type === "app" && !member.name)) {
    throw new ApiRequestError("会话成员响应格式不正确")
  }

  return {
    avatar: member.avatar ?? "",
    email: member.email ?? "",
    id: member.id,
    name: member.name ?? "",
    nickname: member.nickname ?? "",
    phone: member.phone ?? "",
    role:
      member.role === "owner" || member.role === "admin"
        ? member.role
        : "member",
    type,
  }
}

function normalizeConversationProject(
  project: ConversationProjectResponse
): ClientConversationProject {
  if (!project.id || !project.name) {
    throw new ApiRequestError("会话关联项目响应格式不正确")
  }

  return {
    avatar: project.avatar ?? "",
    description: project.description ?? "",
    id: project.id,
    name: project.name,
  }
}

function normalizeConversationType(type: string | undefined) {
  if (type === "direct" || type === "app" || type === "topic") {
    return type
  }

  return "group"
}

function normalizeParentConversationType(type: string | undefined) {
  if (type === "direct" || type === "app") return type
  return "group"
}
