import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import {
  incomingMessageNotification,
  isMessageNotificationSuppressed,
} from "../src/main/account/message-notification-policy.ts"

function message(overrides: Partial<DesktopMessage> = {}): DesktopMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    seq: 1,
    createdAt: "2026-01-01T00:00:00Z",
    senderId: "user-2",
    senderType: "user",
    senderName: "小明",
    isMine: false,
    bodyType: "text",
    content: "你好\n  世界",
    clientMessageId: "",
    reactions: [],
    body: { type: "text", content: "你好\n  世界" },
    ...overrides,
  }
}

test("只为未静音的其他用户和应用消息生成通知", () => {
  assert.deepEqual(incomingMessageNotification(message(), "user-1", false), {
    sender: "小明",
    summary: "你好 世界",
  })
  assert.equal(incomingMessageNotification(message(), "user-1", true), null)
  assert.equal(incomingMessageNotification(message({ senderId: "user-1" }), "user-1", false), null)
  assert.equal(
    incomingMessageNotification(message({ senderType: "system" }), "user-1", false),
    null,
  )
  assert.equal(
    incomingMessageNotification(message({ bodyType: "system_event" }), "user-1", false),
    null,
  )
  assert.equal(incomingMessageNotification(message({ bodyType: "revoked" }), "user-1", false), null)
  assert.ok(incomingMessageNotification(message({ senderType: "app" }), "user-1", false))
})

test("空摘要使用通用文案且长摘要被截断", () => {
  assert.equal(
    incomingMessageNotification(message({ content: " \n " }), "user-1", false)?.summary,
    "收到一条新消息",
  )
  assert.equal(
    incomingMessageNotification(message({ content: "a".repeat(300) }), "user-1", false)?.summary
      .length,
    120,
  )
})

test("仅在当前账号的当前对话处于前台时跳过提醒", () => {
  const event = { targetId: "account-1", conversationId: "conversation-1" }
  const active = { ...event }
  assert.equal(isMessageNotificationSuppressed(event, active, true), true)
  assert.equal(isMessageNotificationSuppressed(event, active, false), false)
  assert.equal(isMessageNotificationSuppressed(event, null, true), false)
  assert.equal(
    isMessageNotificationSuppressed(event, { ...active, conversationId: "conversation-2" }, true),
    false,
  )
  assert.equal(
    isMessageNotificationSuppressed(event, { ...active, targetId: "account-2" }, true),
    false,
  )
})
