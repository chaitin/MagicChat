import type {
  ConversationPresenceEvent,
  ConversationPresenceSender,
} from "../../shared/account-data"

export function parseConversationPresenceEvent(
  targetId: string,
  name: string,
  payload: unknown,
): ConversationPresenceEvent | null {
  if (name === "conversation.status") {
    if (!isRecord(payload)) return null
    const conversationId = boundedString(payload.conversation_id, 128)
    const status = boundedString(payload.status, 32)
    const sender = parseSender(payload.sender)
    if (!conversationId || !status || !sender) return null
    return { targetId, name, conversationId, status, sender }
  }
  if (name === "message.created") {
    if (!isRecord(payload) || !isRecord(payload.message)) return null
    const conversationId = boundedString(payload.message.conversation_id, 128)
    const sender = parseSender(payload.message.sender)
    if (!conversationId || !sender) return null
    return { targetId, name, conversationId, sender }
  }
  return null
}

function parseSender(value: unknown): ConversationPresenceSender | null {
  if (!isRecord(value)) return null
  const id = boundedString(value.id, 128)
  if (!id || (value.type !== "user" && value.type !== "app")) return null
  return { id, type: value.type }
}

function boundedString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength ? value : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
