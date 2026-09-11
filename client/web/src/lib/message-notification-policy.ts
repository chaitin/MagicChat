import {
  isClientMessageInitiatedByUser,
  type ClientConversation,
  type ClientMessage,
} from "@/lib/client-data-api"

export function shouldSuppressMessageNotification({
  conversation,
  currentUserId,
  eventNotificationMuted,
  message,
}: {
  conversation: ClientConversation | undefined
  currentUserId: string
  eventNotificationMuted: boolean
  message: ClientMessage
}) {
  return (
    isClientMessageInitiatedByUser(message, currentUserId) ||
    message.sender.type === "system" ||
    eventNotificationMuted ||
    Boolean(conversation?.notificationMuted)
  )
}
