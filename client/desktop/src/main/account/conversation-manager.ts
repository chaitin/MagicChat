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
import type { AvatarDescriptor } from "./avatar-types"
import {
  avatarDescriptorFromConversationPayload,
  conversationIdFromEvent,
  parseConversation,
  parseConversationBooleanEvent,
  parseMessage,
  requiredString,
} from "./conversation-parser"
import { OutgoingMessageService } from "./outgoing-message-service"

export class ConversationManager {
  private readonly outgoingMessages: OutgoingMessageService

  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly currentUserId: string,
    currentUserName: string,
    onMessagesChanged: (conversationId: string) => void,
  ) {
    this.outgoingMessages = new OutgoingMessageService(
      database,
      client,
      currentUserId,
      currentUserName,
      onMessagesChanged,
    )
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

  async createGroupConversation(input: { name: string; memberIds: string[]; appIds: string[] }) {
    const name = typeof input.name === "string" ? input.name.trim() : ""
    if (!name || name.length > 256) {
      throw new AuthFailure("invalid_group_name", "请输入有效的群聊名称")
    }
    const memberIds = validEntityIds(input.memberIds, "群聊成员")
    const appIds = validEntityIds(input.appIds, "群聊应用")
    const data = await this.client.post("/api/client/conversations/groups", {
      name,
      member_ids: memberIds,
      app_ids: appIds,
    })
    if (!isRecord(data) || !isRecord(data.conversation)) {
      throw new AuthFailure("invalid_response", "创建群聊响应格式不正确")
    }
    const conversation = parseConversation(data.conversation, this.currentUserId)
    this.database.upsertCurrentConversations([conversation])
    return this.database.listConversations().find((item) => item.id === conversation.id)!
  }

  async openContactConversation(input: {
    type: "user" | "app" | "group"
    id: string
    joined?: boolean
  }) {
    this.assertConversationId(input.id)
    const path =
      input.type === "user"
        ? "/api/client/conversations/direct"
        : input.type === "app"
          ? "/api/client/conversations/apps"
          : input.joined
            ? `/api/client/conversations/${encodeURIComponent(input.id)}/restore`
            : `/api/client/conversations/groups/${encodeURIComponent(input.id)}/join`
    const body =
      input.type === "user"
        ? { user_id: input.id }
        : input.type === "app"
          ? { app_id: input.id }
          : {}
    const data = await this.client.post(path, body)
    if (!isRecord(data) || !isRecord(data.conversation)) {
      throw new AuthFailure("invalid_response", "会话操作响应格式不正确")
    }
    const conversation = parseConversation(data.conversation, this.currentUserId)
    this.database.upsertCurrentConversations([conversation])
    return this.database.listConversations().find((item) => item.id === conversation.id)!
  }

  getAvatarDescriptor(type: "group" | "topic", entityId: string): AvatarDescriptor | undefined {
    return avatarDescriptorFromConversationPayload(
      type,
      entityId,
      this.database.getConversationPayload(entityId),
    )
  }

  listMessages(conversationId: string): DesktopMessage[] {
    this.assertConversationId(conversationId)
    return this.database.listMessages(conversationId, this.currentUserId)
  }

  sendTextMessage(...args: Parameters<OutgoingMessageService["sendTextMessage"]>) {
    return this.outgoingMessages.sendTextMessage(...args)
  }

  sendFileMessage(...args: Parameters<OutgoingMessageService["sendFileMessage"]>) {
    return this.outgoingMessages.sendFileMessage(...args)
  }

  sendImageMessage(...args: Parameters<OutgoingMessageService["sendImageMessage"]>) {
    return this.outgoingMessages.sendImageMessage(...args)
  }

  sendVideoMessage(...args: Parameters<OutgoingMessageService["sendVideoMessage"]>) {
    return this.outgoingMessages.sendVideoMessage(...args)
  }

  readOutgoingMedia(...args: Parameters<OutgoingMessageService["readOutgoingMedia"]>) {
    return this.outgoingMessages.readOutgoingMedia(...args)
  }

  getOutgoingMedia(...args: Parameters<OutgoingMessageService["getOutgoingMedia"]>) {
    return this.outgoingMessages.getOutgoingMedia(...args)
  }

  retryMessage(...args: Parameters<OutgoingMessageService["retryMessage"]>) {
    return this.outgoingMessages.retryMessage(...args)
  }

  close() {
    this.outgoingMessages.close()
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

function validEntityIds(values: string[], label: string) {
  if (!Array.isArray(values) || values.length > 500) {
    throw new AuthFailure("invalid_group_members", `${label}不正确`)
  }
  const result = values.map((value) => {
    if (typeof value !== "string" || !value || value.length > 128) {
      throw new AuthFailure("invalid_group_members", `${label}不正确`)
    }
    return value
  })
  return Array.from(new Set(result))
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
