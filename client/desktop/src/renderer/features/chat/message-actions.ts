import type { DesktopMessage } from "../../../shared/account-data"

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
