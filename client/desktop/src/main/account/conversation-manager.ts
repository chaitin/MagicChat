import { randomUUID } from "node:crypto"
import type {
  DesktopConversation,
  DesktopMessage,
  DesktopMessagePage,
  DesktopMessageReactionUser,
  MessageReactionUsersInput,
  SetMessageReactionInput,
} from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { AccountDatabase, type StoredConversation, type StoredMessage } from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { retryNetworkAction } from "./retry"
import type { AvatarDescriptor, AvatarMemberDescriptor } from "./avatar-types"
import { normalizeDesktopMessageDetails, summarizeDesktopMessageBody } from "./message-normalizer"

const builtinAssistantAppId = "00000000-0000-0000-0000-000000000001"

export class ConversationManager {
  private readonly sending = new Set<string>()
  private closed = false

  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly currentUserId: string,
    private readonly currentUserName: string,
    private readonly onMessagesChanged: (conversationId: string) => void,
  ) {
    this.database.failPendingMessages()
  }

  initialize() {
    return this.refresh()
  }

  async refresh() {
    const conversations = await retryNetworkAction(() => this.fetchConversations())
    this.database.upsertCurrentConversations(conversations)
    await mapConcurrent(conversations, 4, async (conversation) => {
      const messages = await retryNetworkAction(() => this.fetchMessages(conversation.id))
      this.database.upsertMessages(messages)
    })
  }

  async applyRealtimeEvent(
    name: string,
    payload: unknown,
  ): Promise<{ conversationIds: string[]; messages: boolean } | null> {
    if (name === "message.created" || name === "message.updated") {
      if (!isRecord(payload) || !isRecord(payload.message)) {
        throw new AuthFailure("invalid_realtime_event", "消息推送格式不正确")
      }
      const conversationId = requiredString(
        payload.message.conversation_id,
        128,
        "message.conversation_id",
      )
      if (!this.database.hasCurrentConversation(conversationId)) {
        await this.refresh()
        return { conversationIds: [], messages: true }
      }
      const message = parseMessage(payload.message, conversationId)
      this.database.upsertMessages([message])
      this.database.touchConversationActivity(conversationId, message.createdAt)
      return { conversationIds: [conversationId], messages: true }
    }
    if (name === "conversation.pin_updated") {
      const event = parseConversationBooleanEvent(payload, "pinned")
      if (!this.database.setConversationPinned(event.conversationId, event.value)) {
        await this.refresh()
      }
      return { conversationIds: [], messages: false }
    }
    if (name === "conversation.mute_updated") {
      const event = parseConversationBooleanEvent(payload, "muted")
      if (!this.database.setConversationMuted(event.conversationId, event.value)) {
        await this.refresh()
      }
      return { conversationIds: [], messages: false }
    }
    if (name === "conversation.removed") {
      const conversationId = conversationIdFromEvent(payload)
      this.database.removeCurrentConversation(conversationId)
      return { conversationIds: [conversationId], messages: false }
    }
    if (
      name === "message.reactions_updated" ||
      name === "message.choice_updated" ||
      name === "conversation.member_mentioned" ||
      name === "conversation.member_choice_received"
    ) {
      const conversationId = conversationIdFromEvent(payload)
      if (!this.database.hasCurrentConversation(conversationId)) {
        await this.refresh()
        return { conversationIds: [], messages: true }
      }
      const messages = await retryNetworkAction(() => this.fetchMessages(conversationId))
      this.database.upsertMessages(messages)
      return { conversationIds: [conversationId], messages: true }
    }
    if (
      name === "conversation.restored" ||
      name === "topic.created" ||
      name === "topic.participated" ||
      name === "topic.archived" ||
      name === "topic.closed"
    ) {
      await this.refresh()
      return { conversationIds: [], messages: true }
    }
    return null
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
    this.assertConversationId(conversationId)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  sendTextMessage(
    conversationId: string,
    content: string,
    bodyType: "text" | "markdown",
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    const normalized = content.trim()
    if (!normalized || normalized.length > 100_000) {
      throw new AuthFailure("invalid_message_content", "消息内容不正确")
    }
    if (bodyType !== "text" && bodyType !== "markdown") {
      throw new AuthFailure("invalid_message_type", "消息类型不正确")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticMessage({
      conversationId,
      clientMessageId,
      content: normalized,
      bodyType,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverMessage(conversationId, clientMessageId, normalized, bodyType)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  sendFileMessage(
    conversationId: string,
    file: { path: string; name: string; sizeBytes: number },
  ): DesktopMessage[] {
    this.assertConversationId(conversationId)
    if (
      !file.path ||
      !file.name ||
      file.name.length > 255 ||
      !Number.isSafeInteger(file.sizeBytes) ||
      file.sizeBytes <= 0 ||
      file.sizeBytes > 500 * 1024 * 1024
    ) {
      throw new AuthFailure("invalid_file", "文件不符合发送要求")
    }
    const clientMessageId = randomUUID()
    this.database.createOptimisticFileMessage({
      conversationId,
      clientMessageId,
      filePath: file.path,
      name: file.name,
      sizeBytes: file.sizeBytes,
      senderId: this.currentUserId,
      senderName: this.currentUserName,
    })
    this.onMessagesChanged(conversationId)
    this.deliverFileMessage(conversationId, clientMessageId, file)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  retryMessage(conversationId: string, clientMessageId: string): DesktopMessage[] {
    this.assertConversationId(conversationId)
    if (!clientMessageId || clientMessageId.length > 128) {
      throw new AuthFailure("invalid_client_message", "待发送消息不存在")
    }
    const message = this.database.getOutgoingMessage(conversationId, clientMessageId)
    if (!message) throw new AuthFailure("message_not_found", "待发送消息不存在")
    if (!this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "sending")) {
      throw new AuthFailure("message_not_found", "待发送消息不存在")
    }
    this.onMessagesChanged(conversationId)
    if (message.bodyType === "file") {
      this.deliverFileMessage(conversationId, clientMessageId, {
        path: message.filePath,
        name: message.name,
        sizeBytes: message.sizeBytes,
      })
    } else {
      this.deliverMessage(conversationId, clientMessageId, message.content, message.bodyType)
    }
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  close() {
    this.closed = true
    this.sending.clear()
  }

  async listMessageReactionUsers(
    input: Omit<MessageReactionUsersInput, "targetId">,
  ): Promise<DesktopMessageReactionUser[]> {
    this.assertConversationId(input.conversationId)
    if (!input.messageId || input.messageId.length > 128) {
      throw new AuthFailure("invalid_message", "消息不存在")
    }
    if (!input.text.trim() || input.text.length > 64) {
      throw new AuthFailure("invalid_reaction", "消息表情不正确")
    }
    const search = new URLSearchParams({ text: input.text })
    const data = await this.client.get(
      `/api/client/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/reactions/users?${search.toString()}`,
    )
    if (
      !isRecord(data) ||
      data.conversation_id !== input.conversationId ||
      data.message_id !== input.messageId ||
      data.text !== input.text ||
      !Array.isArray(data.users)
    ) {
      throw new AuthFailure("invalid_response", "消息表情参与者响应格式不正确")
    }
    return data.users.map((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
        throw new AuthFailure("invalid_response", "消息表情参与者响应格式不正确")
      }
      return {
        id: value.id,
        name: typeof value.name === "string" ? value.name : "",
      }
    })
  }

  async setMessageReaction(
    input: Omit<SetMessageReactionInput, "targetId">,
  ): Promise<DesktopMessage[]> {
    this.assertConversationId(input.conversationId)
    if (!input.messageId || input.messageId.length > 128) {
      throw new AuthFailure("invalid_message", "消息不存在")
    }
    if (!input.text.trim() || input.text.length > 64 || typeof input.reacted !== "boolean") {
      throw new AuthFailure("invalid_reaction", "消息表情不正确")
    }
    const data = await this.client.put(
      `/api/client/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/reactions`,
      { reacted: input.reacted, text: input.text },
    )
    if (
      !isRecord(data) ||
      data.conversation_id !== input.conversationId ||
      data.message_id !== input.messageId ||
      !Number.isSafeInteger(data.reaction_version) ||
      Number(data.reaction_version) < 0 ||
      !Array.isArray(data.reactions) ||
      data.reactions.some(
        (reaction) =>
          !isRecord(reaction) ||
          typeof reaction.text !== "string" ||
          !reaction.text ||
          !Number.isSafeInteger(reaction.count) ||
          Number(reaction.count) <= 0 ||
          (reaction.reacted_by_me !== undefined && typeof reaction.reacted_by_me !== "boolean"),
      )
    ) {
      throw new AuthFailure("invalid_response", "消息表情响应格式不正确")
    }
    if (
      !this.database.updateMessageReactions(
        input.conversationId,
        input.messageId,
        Number(data.reaction_version),
        data.reactions,
      )
    ) {
      throw new AuthFailure("message_not_found", "消息不存在")
    }
    return this.database.listMessages(input.conversationId, this.currentUserId)
  }

  async loadBeforeMessages(conversationId: string, beforeSeq: number): Promise<DesktopMessagePage> {
    this.assertConversationId(conversationId)
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
      throw new AuthFailure("invalid_message_cursor", "消息游标不正确")
    }
    const page = await retryNetworkAction(() => this.fetchMessagePage(conversationId, beforeSeq))
    this.database.upsertMessages(page.messages)
    return {
      messages: this.database.listMessages(conversationId, this.currentUserId),
      hasMoreBefore: page.hasMoreBefore,
    }
  }

  private assertConversationId(conversationId: string) {
    if (!conversationId || conversationId.length > 128) {
      throw new AuthFailure("invalid_conversation", "会话不存在")
    }
  }

  private deliverMessage(
    conversationId: string,
    clientMessageId: string,
    content: string,
    bodyType: "text" | "markdown",
  ) {
    if (this.closed || this.sending.has(clientMessageId)) return
    this.sending.add(clientMessageId)
    void this.client
      .post(`/api/client/conversations/${encodeURIComponent(conversationId)}/messages`, {
        client_message_id: clientMessageId,
        body: { type: bodyType, content },
      })
      .then((data) => {
        if (this.closed || !isRecord(data) || !isRecord(data.message)) {
          if (!this.closed) throw new AuthFailure("invalid_response", "发送消息响应格式不正确")
          return
        }
        this.database.upsertMessages([parseMessage(data.message, conversationId)])
        this.onMessagesChanged(conversationId)
      })
      .catch(() => {
        this.sending.delete(clientMessageId)
        if (this.closed) return
        if (this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "failed")) {
          this.onMessagesChanged(conversationId)
        }
      })
      .finally(() => {
        this.sending.delete(clientMessageId)
      })
  }

  private deliverFileMessage(
    conversationId: string,
    clientMessageId: string,
    file: { path: string; name: string; sizeBytes: number },
  ) {
    if (this.closed || this.sending.has(clientMessageId)) return
    this.sending.add(clientMessageId)
    void this.client
      .postFile(
        `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/files`,
        { client_message_id: clientMessageId },
        file,
      )
      .then((data) => {
        if (this.closed || !isRecord(data) || !isRecord(data.message)) {
          if (!this.closed) throw new AuthFailure("invalid_response", "发送文件响应格式不正确")
          return
        }
        this.database.upsertMessages([parseMessage(data.message, conversationId)])
        this.onMessagesChanged(conversationId)
      })
      .catch(() => {
        this.sending.delete(clientMessageId)
        if (this.closed) return
        if (this.database.setOutgoingMessageStatus(conversationId, clientMessageId, "failed")) {
          this.onMessagesChanged(conversationId)
        }
      })
      .finally(() => {
        this.sending.delete(clientMessageId)
      })
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
    return (await this.fetchMessagePage(conversationId)).messages
  }

  private async fetchMessagePage(conversationId: string, beforeSeq?: number) {
    const search = new URLSearchParams({ limit: "20" })
    if (beforeSeq !== undefined) search.set("before_seq", String(beforeSeq))
    const data = await this.client.get(
      `/api/client/conversations/${encodeURIComponent(conversationId)}/messages?${search}`,
    )
    if (!isRecord(data) || !Array.isArray(data.messages) || !isRecord(data.page)) {
      throw new AuthFailure("invalid_response", "聊天记录响应格式不正确")
    }
    if (typeof data.page.has_more_before !== "boolean") {
      throw new AuthFailure("invalid_response", "聊天记录分页信息格式不正确")
    }
    return {
      messages: data.messages.map((message) => parseMessage(message, conversationId)),
      hasMoreBefore: data.page.has_more_before,
    }
  }
}

function parseConversationBooleanEvent(payload: unknown, field: "pinned" | "muted") {
  if (!isRecord(payload) || typeof payload[field] !== "boolean") {
    throw new AuthFailure("invalid_realtime_event", "会话状态推送格式不正确")
  }
  return {
    conversationId: conversationIdFromEvent(payload),
    value: payload[field],
  }
}

function conversationIdFromEvent(payload: unknown) {
  if (!isRecord(payload)) {
    throw new AuthFailure("invalid_realtime_event", "会话推送格式不正确")
  }
  return requiredString(payload.conversation_id, 128, "event.conversation_id")
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
    createdAt: requiredString(value.created_at, 64, "conversation.created_at"),
    lastMessageAt: nullableString(value.last_message_at, 64),
    lastMessageSummary: "",
    pinned: value.pinned === true,
    notificationMuted: value.notification_muted === true,
    isBuiltinAssistant:
      type === "app" &&
      Array.isArray(value.members) &&
      value.members.some(
        (member) =>
          isRecord(member) && member.type === "app" && member.id === builtinAssistantAppId,
      ),
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
  const details = normalizeDesktopMessageDetails(value)
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
    senderName:
      optionalString(value.sender.nickname, 256) ||
      optionalString(value.sender.name, 256) ||
      (senderType === "system" ? "系统" : ""),
    isMine: false,
    bodyType: details.body.type,
    content: summarizeDesktopMessageBody(details.body),
    clientMessageId: optionalString(value.client_message_id, 128),
    deliveryStatus: undefined,
    ...details,
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
