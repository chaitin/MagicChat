import type { ClientConversation } from "@/data/models"

const BUILTIN_ASSISTANT_APP_ID = "00000000-0000-0000-0000-000000000001"

export function orderConversations(conversations: ClientConversation[]) {
  return [...conversations].sort((left, right) => {
    const leftIsBuiltinAssistant = isBuiltinAssistantConversation(left)
    const rightIsBuiltinAssistant = isBuiltinAssistantConversation(right)

    if (leftIsBuiltinAssistant !== rightIsBuiltinAssistant) {
      return leftIsBuiltinAssistant ? -1 : 1
    }

    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }

    const leftActivity = getConversationActivityTimestamp(left)
    const rightActivity = getConversationActivityTimestamp(right)

    if (leftActivity !== rightActivity) {
      return rightActivity - leftActivity
    }

    return left.id.localeCompare(right.id)
  })
}

export function isBuiltinAssistantConversation(
  conversation: ClientConversation
) {
  return (
    conversation.type === "app" &&
    conversation.members?.some(
      (member) =>
        member.type === "app" && member.id === BUILTIN_ASSISTANT_APP_ID
    ) === true
  )
}

function getConversationActivityTimestamp(conversation: ClientConversation) {
  const timestamp = Date.parse(
    conversation.lastMessageAt ?? conversation.createdAt
  )

  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}
