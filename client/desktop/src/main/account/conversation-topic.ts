import type { DesktopConversation } from "../../shared/account-data.ts"

export function parseConversationTopic(value: unknown): DesktopConversation["topic"] {
  if (!isRecord(value) || value.type !== "topic" || !isRecord(value.topic)) return undefined
  const sourceSender = isRecord(value.topic.source_sender) ? value.topic.source_sender : undefined
  const parentConversationId = optionalString(value.topic.parent_conversation_id, 128)
  const sourceSenderId = optionalString(sourceSender?.id, 128)
  const sourceSenderType =
    sourceSender?.type === "user" ? "user" : sourceSender?.type === "app" ? "app" : null
  if (!parentConversationId || !sourceSenderId || !sourceSenderType) return undefined
  return {
    archived: value.topic.archived === true,
    parentConversationId,
    participating: value.topic.participating === true,
    sourceSender: {
      id: sourceSenderId,
      name: optionalString(sourceSender?.name, 256) || sourceSenderId,
      type: sourceSenderType,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum ? value : ""
}
