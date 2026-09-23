import type { DesktopMessage } from "../../shared/account-data"
import type { IncomingMessageNotification } from "../../shared/desktop"

export function isMessageNotificationSuppressed(
  event: Pick<IncomingMessageNotification, "targetId" | "conversationId">,
  activeConversation: { targetId: string; conversationId: string } | null,
  windowFocused: boolean,
) {
  return Boolean(
    windowFocused &&
    activeConversation?.targetId === event.targetId &&
    activeConversation.conversationId === event.conversationId,
  )
}

export function incomingMessageNotification(
  message: DesktopMessage,
  currentUserId: string,
  muted: boolean,
): { sender: string; summary: string } | null {
  if (
    muted ||
    (message.senderType === "user" && message.senderId === currentUserId) ||
    message.senderType === "system" ||
    message.bodyType === "system_event" ||
    message.bodyType === "revoked"
  )
    return null

  return {
    sender: message.senderName.trim().replace(/\s+/g, " ").slice(0, 64) || "未知用户",
    summary: message.content.trim().replace(/\s+/g, " ").slice(0, 120) || "收到一条新消息",
  }
}
