import type { Href } from "expo-router"

export function buildAddGroupMembersHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]/add-members",
  } as unknown as Href
}

export function buildCreateGroupConversationHref(
  initialUserIds: string[] = []
): Href {
  return {
    params:
      initialUserIds.length > 0
        ? { initialUserIds: initialUserIds.join(",") }
        : {},
    pathname: "/(app)/create-group",
  } as unknown as Href
}

export function buildConversationHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]",
  }
}

export function buildConversationDetailsHref(
  conversationId: string,
  parentConversationId?: string
): Href {
  return {
    params: {
      conversationId,
      ...(parentConversationId ? { parentConversationId, topic: "1" } : {}),
    },
    pathname: "/(app)/conversation/[conversationId]/details",
  } as unknown as Href
}

export function buildConversationReportHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]/report",
  } as unknown as Href
}

export type GroupConversationEditField = "announcement" | "name"

export function buildGroupConversationEditHref(
  conversationId: string,
  field: GroupConversationEditField
): Href {
  return {
    params: { conversationId, field },
    pathname: "/(app)/conversation/[conversationId]/edit-group/[field]",
  } as unknown as Href
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
