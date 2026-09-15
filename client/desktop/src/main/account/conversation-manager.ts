import type { DesktopConversation, DesktopMessage } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { AccountDatabase, type StoredConversation, type StoredMessage } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { retryNetworkAction } from "./retry"

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
    return data.conversations.slice(0, 30).map(parseConversation)
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

function parseConversation(value: unknown): StoredConversation {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "会话列表响应格式不正确")
  const id = requiredString(value.id, 128, "conversation.id")
  const type = requiredString(value.type, 32, "conversation.type")
  const name = requiredString(value.name, 256, "conversation.name")
  return {
    id,
    type,
    name,
    avatar: optionalString(value.avatar, 4_096),
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
