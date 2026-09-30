import type { DesktopMessage } from "../../shared/account-data"
import type { IncomingMessageNotification } from "../../shared/desktop"
import { formatMentionText, type MentionLabelResolver } from "../../shared/message-mentions.ts"

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
  resolvedSenderName?: string,
  resolveMentionLabel: MentionLabelResolver = () => undefined,
): { sender: string; summary: string } | null {
  if (
    muted ||
    (message.senderType === "user" && message.senderId === currentUserId) ||
    message.senderType === "system" ||
    message.bodyType === "system_event" ||
    message.bodyType === "revoked"
  )
    return null

  // 消息里存的 sender_name 往往为空，优先用通讯录现查到的名字。
  const sender = [resolvedSenderName, message.senderName]
    .map((value) => value?.trim().replace(/\s+/g, " ").slice(0, 64))
    .find((value) => Boolean(value))

  return {
    sender: sender || "未知用户",
    summary:
      formatMentionText(message.content, resolveMentionLabel)
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 120) || "收到一条新消息",
  }
}
