import assert from "node:assert/strict"
import test from "node:test"

import type { ClientMessage } from "@/core/models"
import { shouldShowMessageNotification } from "@/notifications/message-notification-policy"

function textMessage(senderId: string) {
  return {
    body: { content: "hello", type: "text" },
    sender: { id: senderId, type: "user" },
  } as ClientMessage
}

test("authoritative realtime mute state overrides stale conversation cache", () => {
  const message = textMessage("sender-1")
  assert.equal(
    shouldShowMessageNotification({
      cachedConversationMuted: false,
      message,
      notificationMuted: true,
      recipientUserId: "recipient-1",
    }),
    false
  )
  assert.equal(
    shouldShowMessageNotification({
      cachedConversationMuted: true,
      message,
      notificationMuted: false,
      recipientUserId: "recipient-1",
    }),
    true
  )
})

test("recipient identity suppresses self messages without profile cache", () => {
  assert.equal(
    shouldShowMessageNotification({
      message: textMessage("recipient-1"),
      notificationMuted: false,
      recipientUserId: "recipient-1",
    }),
    false
  )
})
