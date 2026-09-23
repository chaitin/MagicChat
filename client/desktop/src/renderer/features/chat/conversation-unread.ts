import type { DesktopConversation } from "../../../shared/account-data"

export function conversationUnreadIndicator(
  conversation: Pick<DesktopConversation, "unreadCount" | "notificationMuted">,
): { label: string; text: string | null } | null {
  if (conversation.unreadCount <= 0 || !Number.isFinite(conversation.unreadCount)) return null
  if (conversation.notificationMuted) return { label: "有未读消息", text: null }
  return {
    label: `${conversation.unreadCount} 条未读消息`,
    text: conversation.unreadCount > 99 ? "99+" : String(conversation.unreadCount),
  }
}

export function hasUnmutedUnreadConversations(
  conversations: ReadonlyArray<Pick<DesktopConversation, "unreadCount" | "notificationMuted">>,
): boolean {
  return conversations.some(
    (conversation) => !conversation.notificationMuted &&
      Number.isFinite(conversation.unreadCount) && conversation.unreadCount > 0,
  )
}
