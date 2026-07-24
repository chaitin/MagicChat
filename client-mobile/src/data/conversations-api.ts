import { ApiRequestError, createApiClient, type ApiFetch } from "@/data/api-client"
import type {
  ClientConversation,
  ClientConversationMember,
  ClientConversationProject,
  ClientTopicDetail,
} from "@/data/models"

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

type ConversationResponse = {
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

type ConversationTopicDetailResponse = {
  can_archive?: boolean
  can_participate?: boolean
  conversation?: ConversationResponse
}

type ConversationRequestOptions = {
  fetcher?: ApiFetch
  signal?: AbortSignal
}

export async function fetchConversations(
  serverUrl: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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

export async function setConversationPinned(
  serverUrl: string,
  conversationId: string,
  pinned: boolean,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
  serverUrl: string,
  conversationId: string,
  muted: boolean,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
  serverUrl: string,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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

export async function openDirectConversation(
  serverUrl: string,
  userId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
  serverUrl: string,
  appId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
  serverUrl: string,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
  serverUrl: string,
  conversationId: string,
  options: ConversationRequestOptions = {}
): Promise<ClientTopicDetail> {
  const data = await createApiClient(serverUrl, options.fetcher).request<
    ConversationTopicDetailResponse
  >(`/api/client/conversations/topics/${encodeURIComponent(conversationId)}`, {
    errorMessage: "加载话题失败",
    method: "GET",
    signal: options.signal,
  })

  if (!data?.conversation) {
    throw new ApiRequestError("话题详情响应格式不正确")
  }

  return {
    canArchive: Boolean(data.can_archive),
    canParticipate: Boolean(data.can_participate),
    conversation: normalizeConversation(data.conversation),
  }
}

export async function archiveConversationTopic(
  serverUrl: string,
  conversationId: string,
  options: ConversationRequestOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
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
    avatar: conversation.avatar ?? "",
    createdAt: conversation.created_at,
    id: conversation.id,
    lastMessageAt: conversation.last_message_at ?? null,
    lastMessageId: conversation.last_message_id ?? null,
    lastMessageSeq: conversation.last_message_seq ?? 0,
    lastMessageSummary: conversation.last_message_summary ?? "",
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
    !sourceSender.name ||
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
      name: sourceSender.name,
      type: sourceSender.type,
    },
  }
}

function normalizeConversationMember(
  member: ConversationMemberResponse
): ClientConversationMember {
  const type = member.type === "app" ? "app" : "user"

  if (!member.id || !member.name || (type === "user" && !member.email)) {
    throw new ApiRequestError("会话成员响应格式不正确")
  }

  return {
    avatar: member.avatar ?? "",
    email: member.email ?? "",
    id: member.id,
    name: member.name,
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
