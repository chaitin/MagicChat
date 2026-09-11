import type { ClientConversation } from "@/lib/client-data-api"

export function getConversationAvatarType(
  conversation: ClientConversation
): "direct" | "group" | "app" {
  if (conversation.type === "topic") {
    return conversation.topic?.parentConversationType ?? "group"
  }
  return conversation.type
}

export function getConversationAvatarName(conversation: ClientConversation) {
  if (conversation.type === "topic") {
    return conversation.topic?.parentConversationName || conversation.name
  }
  return conversation.name
}

export function getConversationDisplayName(conversation: ClientConversation) {
  const name = conversation.name.trim()
  const parentName = conversation.topic?.parentConversationName.trim()

  return conversation.type === "topic" && parentName
    ? `${name} - ${parentName}`
    : name
}
