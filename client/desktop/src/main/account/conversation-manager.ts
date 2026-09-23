import { randomUUID } from "node:crypto"
import type {
  DesktopConversation,
  DesktopMessage,
  DesktopMessagePage,
  DesktopMessageReactionUser,
  MessageReactionUsersInput,
  SendRichMessageInput,
  SetMessageReactionInput,
  SubmitChoiceResponseInput,
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
import { normalizeDesktopMessageChoiceState } from "./message-normalizer"
import {
  contiguousMessageSuffix,
  isCompleteLocalPage,
  MESSAGE_PAGE_SIZE,
} from "../../shared/message-window"
import { normalizeOutgoingRichMessageBody } from "./rich-message-input"
import { OutgoingMessageService } from "./outgoing-message-service"
export class ConversationManager {
  private readonly outgoingMessages: OutgoingMessageService
  private readonly virtualMessages = new Map<string, DesktopMessage[]>()

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
    const currentConversationIds = new Set(conversations.map((conversation) => conversation.id))
    for (const conversationId of this.virtualMessages.keys()) {
      if (!currentConversationIds.has(conversationId)) this.virtualMessages.delete(conversationId)
    }
    await mapConcurrent(conversations, 4, async (conversation) => {
      const messages = await retryNetworkAction(() => this.fetchMessages(conversation.id))
      this.database.upsertMessages(messages)
    })
  }

  async applyRealtimeEvent(
    name: string,
    payload: unknown,
  ): Promise<{
    conversationIds: string[]
    messages: boolean
    notification?: { message: DesktopMessage; muted: boolean }
  } | null> {
    if (name === "message.created" || name === "message.updated") {
      if (!isRecord(payload) || !isRecord(payload.message)) {
        throw new AuthFailure("invalid_realtime_event", "消息推送格式不正确")
      }
      const conversationId = requiredString(
        payload.message.conversation_id,
        128,
        "message.conversation_id",
      )
      const message = parseMessage(payload.message, conversationId)
      const alreadyPresent = this.database.hasMessage(conversationId, message.id)
      if (!this.database.hasCurrentConversation(conversationId)) {
        await this.refresh()
        return {
          conversationIds: [],
          messages: true,
          notification:
            name === "message.created" && !alreadyPresent &&
            this.database.hasCurrentConversation(conversationId)
              ? {
                  message,
                  muted:
                    payload.notification_muted === true ||
                    this.database.isConversationMuted(conversationId),
                }
              : undefined,
        }
      }
      this.database.upsertMessages([message])
      if (name === "message.created") {
        this.database.applyConversationMessageSeq(
          conversationId, message.seq, message.senderType === "user" && message.senderId === this.currentUserId,
        )
      }
      this.database.touchConversationActivity(conversationId, message.createdAt)
      const parentConversationId = this.updateTopicParentPreview(conversationId)
      return {
        notification:
          name === "message.created" && !alreadyPresent
            ? {
                message,
                muted:
                  payload.notification_muted === true ||
                  this.database.isConversationMuted(conversationId),
              }
            : undefined,
        conversationIds: parentConversationId
          ? [conversationId, parentConversationId]
          : [conversationId],
        messages: true,
      }
    }
    if (name === "conversation.read_updated") {
      const conversationId = conversationIdFromEvent(payload)
      if (!isRecord(payload) || typeof payload.last_read_seq !== "number" ||
        !Number.isSafeInteger(payload.last_read_seq) || payload.last_read_seq < 0) {
        throw new AuthFailure("invalid_realtime_event", "会话已读推送格式不正确")
      }
      if (!this.database.applyConversationReadSeq(conversationId, payload.last_read_seq)) {
        await this.refresh()
      }
      return { conversationIds: [conversationId], messages: false }
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
      this.virtualMessages.delete(conversationId)
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

  listConversations(selectedConversationId: string | null = null): DesktopConversation[] {
    return this.database.listConversations(selectedConversationId).map((conversation) => ({
      ...conversation,
      canSend: this.canSendMessages(conversation),
      canModerateMessages: this.canModerateMessages(conversation),
    }))
  }

  async markRead(conversationId: string, upToSeq: number) {
    this.assertConversationId(conversationId)
    if (!Number.isSafeInteger(upToSeq) || upToSeq <= 0) {
      throw new AuthFailure("invalid_read_seq", "已读消息序号不正确")
    }
    const lastReadSeq = this.database.getConversationReadSeq(conversationId)
    if (lastReadSeq === undefined) throw new AuthFailure("conversation_not_found", "对话不存在")
    if (upToSeq <= lastReadSeq) return
    const data = await this.client.post(
      `/api/client/conversations/${encodeURIComponent(conversationId)}/read`,
      { up_to_seq: upToSeq },
    )
    if (!isRecord(data) || data.conversation_id !== conversationId ||
      typeof data.last_read_seq !== "number" || !Number.isSafeInteger(data.last_read_seq) ||
      data.last_read_seq < 0) {
      throw new AuthFailure("invalid_response", "会话已读响应格式不正确")
    }
    this.database.applyConversationReadSeq(conversationId, data.last_read_seq)
  }

  async setConversationPinned(conversationId: string, pinned: boolean) {
    this.assertConversationId(conversationId)
    if (typeof pinned !== "boolean") {
      throw new AuthFailure("invalid_conversation_pin", "会话置顶状态不正确")
    }
    const path = `/api/client/conversations/${encodeURIComponent(conversationId)}/pin`
    const data = pinned ? await this.client.put(path, {}) : await this.client.delete(path)
    if (
      !isRecord(data) ||
      data.conversation_id !== conversationId ||
      typeof data.pinned !== "boolean"
    ) {
      throw new AuthFailure("invalid_response", "会话置顶响应格式不正确")
    }
    if (!this.database.setConversationPinned(conversationId, data.pinned)) {
      throw new AuthFailure("conversation_not_found", "对话不存在")
    }
    return this.listConversations()
  }

  async setConversationMuted(conversationId: string, muted: boolean) {
    this.assertConversationId(conversationId)
    if (typeof muted !== "boolean") {
      throw new AuthFailure("invalid_conversation_mute", "会话免打扰状态不正确")
    }
    const path = `/api/client/conversations/${encodeURIComponent(conversationId)}/mute`
    const data = muted ? await this.client.put(path, {}) : await this.client.delete(path)
    if (
      !isRecord(data) ||
      data.conversation_id !== conversationId ||
      typeof data.muted !== "boolean"
    ) {
      throw new AuthFailure("invalid_response", "会话免打扰响应格式不正确")
    }
    if (!this.database.setConversationMuted(conversationId, data.muted)) {
      throw new AuthFailure("conversation_not_found", "对话不存在")
    }
    return this.listConversations()
  }

  async dismissConversation(conversationId: string) {
    this.assertConversationId(conversationId)
    const data = await this.client.delete(
      `/api/client/conversations/${encodeURIComponent(conversationId)}`,
    )
    if (!isRecord(data) || data.conversation_id !== conversationId) {
      throw new AuthFailure("invalid_response", "删除对话响应格式不正确")
    }
    this.database.removeCurrentConversation(conversationId)
    this.virtualMessages.delete(conversationId)
    return this.listConversations()
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

  listMessages(conversationId: string, latestLimit?: number): DesktopMessage[] {
    this.assertConversationId(conversationId)
    if (
      latestLimit !== undefined &&
      (!Number.isSafeInteger(latestLimit) || latestLimit < 1 || latestLimit > 10_000)
    ) {
      throw new AuthFailure("invalid_message_limit", "消息加载数量不正确")
    }
    const messages = this.database.listMessages(conversationId, this.currentUserId, latestLimit)
    return this.withVirtualMessages(
      conversationId,
      latestLimit === undefined ? messages : contiguousMessageSuffix(messages),
    )
  }

  sendTextMessage(...args: Parameters<OutgoingMessageService["sendTextMessage"]>) {
    return this.withVirtualMessages(args[0], this.outgoingMessages.sendTextMessage(...args))
  }

  async sendRichMessage(input: Omit<SendRichMessageInput, "targetId">) {
    this.assertConversationId(input.conversationId)
    const normalized = normalizeOutgoingRichMessageBody(input.body)
    if (
      input.replyToMessageId !== undefined &&
      (!input.replyToMessageId || input.replyToMessageId.length > 128)
    ) {
      throw new AuthFailure("invalid_reply_message", "回复的消息不正确")
    }
    const data = await this.client.post(
      `/api/client/conversations/${encodeURIComponent(input.conversationId)}/messages`,
      {
        client_message_id: randomUUID(),
        ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
        body: normalized,
      },
    )
    if (!isRecord(data) || !isRecord(data.message)) {
      throw new AuthFailure("invalid_response", "发送富消息响应格式不正确")
    }
    const message = parseMessage(data.message, input.conversationId)
    this.database.upsertMessages([message])
    this.database.touchConversationActivity(input.conversationId, message.createdAt)
    return this.listMessages(input.conversationId)
  }

  sendFileMessage(...args: Parameters<OutgoingMessageService["sendFileMessage"]>) {
    return this.withVirtualMessages(args[0], this.outgoingMessages.sendFileMessage(...args))
  }

  sendImageMessage(...args: Parameters<OutgoingMessageService["sendImageMessage"]>) {
    return this.withVirtualMessages(args[0], this.outgoingMessages.sendImageMessage(...args))
  }

  sendVideoMessage(...args: Parameters<OutgoingMessageService["sendVideoMessage"]>) {
    return this.withVirtualMessages(args[0], this.outgoingMessages.sendVideoMessage(...args))
  }

  readOutgoingMedia(...args: Parameters<OutgoingMessageService["readOutgoingMedia"]>) {
    return this.outgoingMessages.readOutgoingMedia(...args)
  }

  getOutgoingMedia(...args: Parameters<OutgoingMessageService["getOutgoingMedia"]>) {
    return this.outgoingMessages.getOutgoingMedia(...args)
  }

  retryMessage(...args: Parameters<OutgoingMessageService["retryMessage"]>) {
    return this.withVirtualMessages(args[0], this.outgoingMessages.retryMessage(...args))
  }

  async createMessageTopic(conversationId: string, messageId: string) {
    this.assertConversationId(conversationId)
    if (!messageId || messageId.length > 128) {
      throw new AuthFailure("invalid_message", "消息不存在")
    }
    const data = await this.client.post(
      `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/topic`,
      {},
    )
    if (!isRecord(data) || !isRecord(data.conversation)) {
      throw new AuthFailure("invalid_response", "创建话题响应格式不正确")
    }
    const topicConversation = parseConversation(data.conversation, this.currentUserId)
    if (topicConversation.type !== "topic" || !topicConversation.topic) {
      throw new AuthFailure("invalid_response", "创建话题响应格式不正确")
    }
    this.database.upsertCurrentConversations([topicConversation])
    this.database.setMessageTopic(conversationId, messageId, {
      conversationId: topicConversation.id,
      archived: topicConversation.topic.archived,
    })
    const conversations = this.listConversations()
    return {
      conversation:
        conversations.find((conversation) => conversation.id === topicConversation.id) ??
        topicConversation,
      conversations,
      messages: this.listMessages(conversationId),
      created: data.created === true,
    }
  }

  async revokeMessage(conversationId: string, messageId: string) {
    this.assertConversationId(conversationId)
    if (!messageId || messageId.length > 128) {
      throw new AuthFailure("invalid_message", "消息不存在")
    }
    const data = await this.client.post(
      `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/revoke`,
      {},
    )
    if (!isRecord(data) || !isRecord(data.message) || !isRecord(data.system_message)) {
      throw new AuthFailure("invalid_response", "撤回消息响应格式不正确")
    }
    const message = parseMessage(data.message, conversationId)
    const systemMessage = parseMessage(data.system_message, conversationId)
    this.database.upsertMessages([message, systemMessage])
    this.database.touchConversationActivity(conversationId, systemMessage.createdAt)
    this.updateTopicParentPreview(conversationId)
    return this.listMessages(conversationId)
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
    return this.listMessages(input.conversationId)
  }

  async submitChoiceResponse(
    input: Omit<SubmitChoiceResponseInput, "targetId">,
  ): Promise<DesktopMessage[]> {
    this.assertConversationId(input.conversationId)
    if (!input.messageId || input.messageId.length > 128) {
      throw new AuthFailure("invalid_message", "消息不存在")
    }
    if (
      !Array.isArray(input.optionIds) ||
      input.optionIds.length === 0 ||
      input.optionIds.length > 100 ||
      input.optionIds.some((id) => typeof id !== "string" || !id || id.length > 128)
    ) {
      throw new AuthFailure("invalid_choice", "请选择有效选项")
    }
    const optionIds = Array.from(new Set(input.optionIds))
    const data = await this.client.put(
      `/api/client/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/choice-response`,
      { option_ids: optionIds },
    )
    if (
      !isRecord(data) ||
      data.conversation_id !== input.conversationId ||
      data.message_id !== input.messageId ||
      !normalizeDesktopMessageChoiceState(data.choice)
    ) {
      throw new AuthFailure("invalid_response", "选择响应格式不正确")
    }
    if (!this.database.updateMessageChoice(input.conversationId, input.messageId, data.choice)) {
      throw new AuthFailure("message_not_found", "消息不存在")
    }
    return this.listMessages(input.conversationId)
  }

  async loadBeforeMessages(
    conversationId: string,
    beforeSeq: number,
    loadedCount: number,
  ): Promise<DesktopMessagePage> {
    this.assertConversationId(conversationId)
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
      throw new AuthFailure("invalid_message_cursor", "消息游标不正确")
    }
    if (!Number.isSafeInteger(loadedCount) || loadedCount < 1 || loadedCount > 10_000) {
      throw new AuthFailure("invalid_message_limit", "消息加载数量不正确")
    }
    const localMessages = this.database.listMessages(
      conversationId,
      this.currentUserId,
      MESSAGE_PAGE_SIZE,
      beforeSeq,
    )
    if (isCompleteLocalPage(localMessages, beforeSeq)) {
      return {
        messages: this.listMessages(conversationId, loadedCount + localMessages.length),
        hasMoreBefore: localMessages[0].seq > 1,
      }
    }
    const page = await retryNetworkAction(() => this.fetchMessagePage(conversationId, beforeSeq))
    const storedMessages = this.captureVirtualMessages(conversationId, page.messages)
    this.database.upsertMessages(storedMessages)
    return {
      messages: this.listMessages(conversationId, loadedCount + storedMessages.length),
      hasMoreBefore: page.hasMoreBefore,
    }
  }

  private canSendMessages(conversation: DesktopConversation) {
    const payload = this.database.getConversationPayload(conversation.id)
    return !isRecord(payload) || payload.can_send !== false
  }

  private canModerateMessages(conversation: DesktopConversation) {
    const payload = this.database.getConversationPayload(conversation.id)
    if (!isRecord(payload)) return false
    const topic = isRecord(payload.topic) ? payload.topic : undefined
    const groupConversation =
      conversation.type === "group" ||
      (conversation.type === "topic" && topic?.parent_conversation_type === "group")
    if (!groupConversation || !Array.isArray(payload.members)) return false
    const currentMember = payload.members.find(
      (member) => isRecord(member) && member.type === "user" && member.id === this.currentUserId,
    )
    return (
      isRecord(currentMember) && (currentMember.role === "owner" || currentMember.role === "admin")
    )
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

  private updateTopicParentPreview(topicConversationId: string) {
    const payload = this.database.getConversationPayload(topicConversationId)
    const topic = isRecord(payload) ? payload.topic : undefined
    if (!isRecord(topic)) return null
    const parentConversationId =
      typeof topic.parent_conversation_id === "string" ? topic.parent_conversation_id : ""
    const sourceMessageId =
      typeof topic.source_message_id === "string" ? topic.source_message_id : ""
    if (!parentConversationId || !sourceMessageId) return null

    const recentReplies = this.database
      .listMessages(topicConversationId, this.currentUserId)
      .filter(
        (message) =>
          (message.senderType === "user" || message.senderType === "app") &&
          message.body.type !== "revoked",
      )
      .slice(-3)
      .map((message) => ({
        id: message.id,
        created_at: message.createdAt,
        sender: { id: message.senderId, type: message.senderType },
        summary: message.content,
      }))
    return this.database.updateMessageTopicRecentReplies(
      parentConversationId,
      sourceMessageId,
      recentReplies,
    )
      ? parentConversationId
      : null
  }

  private async fetchMessages(conversationId: string): Promise<StoredMessage[]> {
    const messages = (await this.fetchMessagePage(conversationId)).messages
    return this.captureVirtualMessages(conversationId, messages)
  }

  private captureVirtualMessages(conversationId: string, messages: StoredMessage[]) {
    const virtualMessages = messages.flatMap(({ payload: _payload, ...message }) =>
      message.virtualType === "topic_source" ? [message] : [],
    )
    if (virtualMessages.length > 0) this.virtualMessages.set(conversationId, virtualMessages)
    return messages.filter((message) => message.virtualType !== "topic_source")
  }

  private withVirtualMessages(conversationId: string, messages: DesktopMessage[]) {
    const virtualMessages = this.virtualMessages.get(conversationId) ?? []
    if (virtualMessages.length === 0) return messages
    const virtualIds = new Set(virtualMessages.map((message) => message.id))
    return [...virtualMessages, ...messages.filter((message) => !virtualIds.has(message.id))]
  }

  private async fetchMessagePage(conversationId: string, beforeSeq?: number) {
    const search = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) })
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
