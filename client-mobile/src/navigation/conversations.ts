import type { Href } from "expo-router"

export function buildConversationHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]",
  }
}
