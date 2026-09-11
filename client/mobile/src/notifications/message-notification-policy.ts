import type { ClientMessage } from "@/core/models"

export function shouldShowMessageNotification({
  cachedConversationMuted,
  message,
  notificationMuted,
  recipientUserId,
}: {
  cachedConversationMuted?: boolean
  message: ClientMessage
  notificationMuted?: boolean
  recipientUserId: string
}) {
  if (isMessageInitiatedByUser(message, recipientUserId)) return false
  return notificationMuted === undefined
    ? !cachedConversationMuted
    : !notificationMuted
}

function isMessageInitiatedByUser(message: ClientMessage, userId: string) {
  if (message.sender.type === "user") {
    return message.sender.id === userId
  }
  if (message.body.type !== "system_event") {
    return false
  }
  if (message.body.event === "group_members_invited") {
    return message.body.inviter.id === userId
  }
  return message.body.actor.id === userId
}
