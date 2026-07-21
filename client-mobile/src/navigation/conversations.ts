import type { Href } from "expo-router"

export function buildConversationHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]",
  }
}

export function buildTopicConversationHref(
  parentConversationId: string,
  conversationId: string
): Href {
  return {
    params: { conversationId, parentConversationId },
    pathname:
      "/(app)/conversation/[parentConversationId]/topic/[conversationId]",
  } as unknown as Href
}
