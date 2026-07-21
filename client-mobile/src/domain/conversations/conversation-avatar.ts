import type { ClientConversation } from "@/data/models"

export type ConversationAvatarType = Exclude<
  ClientConversation["type"],
  "topic"
>

export function getConversationAvatarType(
  conversation: ClientConversation
): ConversationAvatarType {
  if (conversation.type === "topic") {
    return conversation.topic?.parentConversationType ?? "group"
  }

  return conversation.type
}

export function getConversationAvatarName(conversation: ClientConversation) {
  if (conversation.type === "topic") {
    return (
      conversation.topic?.parentConversationName.trim() || conversation.name
    )
  }

  return conversation.name
}
