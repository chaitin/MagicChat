import { normalizeClientMessage } from "@/data/messages/message-normalizer"

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizeMessageEventPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || !("message" in value)) throw new Error("实时消息格式不正确")
  return {
    message: normalizeClientMessage(value.message),
    notificationMuted:
      typeof value.notification_muted === "boolean" ? value.notification_muted : undefined,
  }
}

export function normalizeConversationRemovedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string") throw new Error("实时会话移除事件格式不正确")
  return value.conversation_id
}

export function normalizeConversationMentionedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string" || typeof value.last_mentioned_seq !== "number" || !Number.isFinite(value.last_mentioned_seq) || value.last_mentioned_seq <= 0) throw new Error("实时会话提醒事件格式不正确")
  return { conversationId: value.conversation_id, lastMentionedSeq: value.last_mentioned_seq }
}

export function normalizeConversationChoiceReceivedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string" || value.conversation_id.length === 0 || typeof value.last_choice_seq !== "number" || !Number.isSafeInteger(value.last_choice_seq) || value.last_choice_seq <= 0) throw new Error("实时选择消息提醒事件格式不正确")
  return { conversationId: value.conversation_id, lastChoiceSeq: value.last_choice_seq }
}

export function normalizeConversationPinUpdatedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string" || value.conversation_id.trim() === "" || typeof value.pinned !== "boolean") throw new Error("实时会话置顶事件格式不正确")
  return { conversationId: value.conversation_id, pinned: value.pinned }
}

export function normalizeConversationMuteUpdatedPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string" || value.conversation_id.trim() === "" || typeof value.muted !== "boolean") throw new Error("实时会话免打扰事件格式不正确")
  return { conversationId: value.conversation_id, muted: value.muted }
}

export function normalizeTopicEventPayload(payload: unknown) {
  const value = asRecord(payload)
  if (!value || typeof value.conversation_id !== "string" || typeof value.parent_conversation_id !== "string" || typeof value.source_message_id !== "string") throw new Error("实时话题事件格式不正确")
  return { archived: Boolean(value.archived), conversationId: value.conversation_id, parentConversationId: value.parent_conversation_id, sourceMessageId: value.source_message_id }
}
