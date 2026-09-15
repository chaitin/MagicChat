import type { DesktopConversation, DesktopMessage } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { AccountDatabase, type StoredConversation, type StoredMessage } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { retryNetworkAction } from "./retry"
import type { AvatarDescriptor, AvatarMemberDescriptor } from "./avatar-types"

export class ConversationManager {
  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly currentUserId: string,
  ) {}

  async initialize() {
    const conversations = await retryNetworkAction(() => this.fetchConversations())
    this.database.replaceCurrentConversations(conversations)
    await mapConcurrent(conversations, 4, async (conversation) => {
      const messages = await retryNetworkAction(() => this.fetchMessages(conversation.id))
      this.database.upsertMessages(messages)
    })
  }

  listConversations(): DesktopConversation[] {
    return this.database.listConversations()
  }

  getAvatarDescriptor(type: "group" | "topic", entityId: string): AvatarDescriptor | undefined {
    const payload = this.database.getConversationPayload(entityId)
    if (!isRecord(payload)) return undefined
    if (type === "topic" && isRecord(payload.topic)) {
      const parentId = optionalString(payload.topic.parent_conversation_id, 128)
      const parentType = avatarTypeForConversation(
        optionalString(payload.topic.parent_conversation_type, 32),
      )
      if (parentId) {
        return {
          type: parentType,
          id: parentId,
          name:
            optionalString(payload.topic.parent_conversation_name, 256) ||
            optionalString(payload.name, 256),
          avatarUrl: optionalString(payload.avatar, 4_096),
          ...(parentType === "group" ? { members: parseAvatarMembers(payload.members) } : {}),
        }
      }
    }
    return {
      type: "group",
      id: entityId,
      name: optionalString(payload.name, 256),
      avatarUrl: optionalString(payload.avatar, 4_096),
      members: parseAvatarMembers(payload.members),
    }
  }

  listMessages(conversationId: string): DesktopMessage[] {
    if (!conversationId || conversationId.length > 128) {
      throw new AuthFailure("invalid_conversation", "会话不存在")
    }
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  private async fetchConversations(): Promise<StoredConversation[]> {
    const data = await this.client.get("/api/client/conversations")
    if (!isRecord(data) || !Array.isArray(data.conversations)) {
      throw new AuthFailure("invalid_response", "会话列表响应格式不正确")
    }
    return data.conversations
      .slice(0, 30)
      .map((conversation) => parseConversation(conversation, this.currentUserId))
  }

  private async fetchMessages(conversationId: string): Promise<StoredMessage[]> {
    const data = await this.client.get(
      `/api/client/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`,
    )
    if (!isRecord(data) || !Array.isArray(data.messages) || !isRecord(data.page)) {
      throw new AuthFailure("invalid_response", "聊天记录响应格式不正确")
    }
    return data.messages.map((message) => parseMessage(message, conversationId))
  }
}

function parseConversation(value: unknown, currentUserId: string): StoredConversation {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "会话列表响应格式不正确")
  const id = requiredString(value.id, 128, "conversation.id")
  const type = requiredString(value.type, 32, "conversation.type")
  const name = requiredString(value.name, 256, "conversation.name")
  const avatarIdentity = conversationAvatarIdentity(value, id, type, currentUserId)
  return {
    id,
    type,
    name,
    avatar: optionalString(value.avatar, 4_096),
    avatarType: avatarIdentity.type,
    avatarId: avatarIdentity.id,
    lastMessageAt: nullableString(value.last_message_at, 64),
    lastMessageSummary: optionalString(value.last_message_summary, 4_096),
    pinned: value.pinned === true,
    unreadCount: nonNegativeInteger(value.unread_count),
    payload: value,
  }
}

function parseMessage(value: unknown, expectedConversationId: string): StoredMessage {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "聊天记录响应格式不正确")
  const conversationId = requiredString(value.conversation_id, 128, "message.conversation_id")
  if (conversationId !== expectedConversationId) {
    throw new AuthFailure("invalid_response", "聊天记录所属会话不正确")
  }
  if (!isRecord(value.sender)) {
    throw new AuthFailure("invalid_response", "聊天记录发送者格式不正确")
  }
  const body = isRecord(value.body) ? value.body : {}
  const senderType = requiredString(value.sender.type, 32, "message.sender.type")
  const senderId =
    senderType === "system"
      ? optionalString(value.sender.id, 128)
      : requiredString(value.sender.id, 128, "message.sender.id")
  return {
    id: requiredString(value.id, 128, "message.id"),
    conversationId,
    seq: positiveInteger(value.seq),
    createdAt: requiredString(value.created_at, 64, "message.created_at"),
    senderId,
    senderType,
    isMine: false,
    bodyType: optionalString(body.type, 64) || "unknown",
    content: messageContent(body),
    payload: value,
  }
}

function conversationAvatarIdentity(
  value: Record<string, unknown>,
  conversationId: string,
  conversationType: string,
  currentUserId: string,
): Pick<AvatarDescriptor, "type" | "id"> {
  if (conversationType === "topic" && isRecord(value.topic)) {
    const parentId = optionalString(value.topic.parent_conversation_id, 128)
    if (parentId) {
      return {
        type: avatarTypeForConversation(optionalString(value.topic.parent_conversation_type, 32)),
        id: parentId,
      }
    }
  }
  if (conversationType === "direct" || conversationType === "app") {
    const members = parseAvatarMembers(value.members)
    const preferred = members.find((member) =>
      conversationType === "app" ? member.type === "app" : member.id !== currentUserId,
    )
    if (preferred) return { type: preferred.type, id: preferred.id }
  }
  return { type: "group", id: conversationId }
}

function avatarTypeForConversation(type: string): AvatarDescriptor["type"] {
  if (type === "direct" || type === "user") return "user"
  if (type === "app") return "app"
  if (type === "project") return "project"
  return "group"
}

function parseAvatarMembers(value: unknown): AvatarMemberDescriptor[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((member) => {
    if (!isRecord(member) || typeof member.id !== "string" || !member.id) return []
    return [
      {
        type: member.type === "app" ? "app" : "user",
        id: member.id,
        name: optionalString(member.nickname, 256) || optionalString(member.name, 256),
        avatarUrl: optionalString(member.avatar, 4_096),
        role: member.role === "owner" || member.role === "admin" ? member.role : "member",
      } satisfies AvatarMemberDescriptor,
    ]
  })
}

function messageContent(body: Record<string, unknown>): string {
  for (const key of ["content", "caption", "title", "name", "summary"]) {
    const value = body[key]
    if (typeof value === "string" && value.trim()) return value
  }
  const type = typeof body.type === "string" ? body.type : "unknown"
  const labels: Record<string, string> = {
    image: "[图片]",
    file: "[文件]",
    voice: "[语音]",
    chart: "[图表]",
    location: "[位置]",
    unknown: "[消息]",
  }
  return labels[type] ?? "[系统消息]"
}

function requiredString(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string") {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  const result = value.trim()
  if (!result || result.length > maximum) {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  return result
}

function optionalString(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : ""
}

function nullableString(value: unknown, maximum: number): string | null {
  return value === null || value === undefined ? null : optionalString(value, maximum) || null
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AuthFailure("invalid_response", "响应序号格式不正确")
  }
  return Number(value)
}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
) {
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const value = values[index]
      index += 1
      await operation(value)
    }
  })
  const outcomes = await Promise.allSettled(workers)
  const failure = outcomes.find((outcome) => outcome.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}
