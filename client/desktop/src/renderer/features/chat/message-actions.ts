import type { DesktopMessage, DesktopMessageReplyTarget } from "../../../shared/account-data"
import type { MentionLabelResolver } from "@/lib/message-mentions"

export function getDesktopMessageReplyAuthor(
  reply: DesktopMessageReplyTarget,
  resolveLabel: MentionLabelResolver,
) {
  if (!reply.senderId || !reply.senderType) return reply.author
  const name = resolveLabel({ id: reply.senderId, type: reply.senderType })
  if (name && name.toLowerCase() !== reply.senderId.toLowerCase()) return name
  if (reply.author && reply.author.toLowerCase() !== reply.senderId.toLowerCase())
    return reply.author
  return reply.senderType === "app" ? "未知应用" : "未知用户"
}

export function getDesktopMessageEditableBody(message: DesktopMessage) {
  return message.isMine && message.body.type === "revoked" ? message.body.editableBody : undefined
}

export function canCreateDesktopMessageTopic(
  message: DesktopMessage,
  topicCreationEnabled: boolean,
  pending: boolean,
) {
  return (
    topicCreationEnabled &&
    !message.topic &&
    !message.deliveryStatus &&
    !message.virtualType &&
    (message.senderType === "user" || message.senderType === "app") &&
    message.body.type !== "revoked" &&
    message.body.type !== "system_event" &&
    !pending
  )
}

export function canRevokeDesktopMessage(
  message: DesktopMessage,
  revokeEnabled: boolean,
  canModerateMessages: boolean,
  pending: boolean,
) {
  return (
    revokeEnabled &&
    (message.isMine || canModerateMessages) &&
    !message.deliveryStatus &&
    !message.virtualType &&
    message.body.type !== "revoked" &&
    message.body.type !== "unsupported" &&
    message.body.type !== "system_event" &&
    !pending
  )
}
