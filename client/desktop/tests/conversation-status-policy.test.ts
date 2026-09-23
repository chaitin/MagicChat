import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import { shouldSendConversationStatus } from "../src/renderer/features/chat/conversation-status-policy.ts"

test("聚焦的单聊或应用会话有非空草稿时发送输入状态", () => {
  assert.equal(
    shouldSendConversationStatus(conversation("direct"), "hello", true, true, true),
    true,
  )
  assert.equal(shouldSendConversationStatus(conversation("app"), "hello", true, true, true), true)
})

test("群聊、话题和不可发送会话不发送输入状态", () => {
  assert.equal(
    shouldSendConversationStatus(conversation("group"), "hello", true, true, true),
    false,
  )
  assert.equal(
    shouldSendConversationStatus(conversation("topic"), "hello", true, true, true),
    false,
  )
  assert.equal(
    shouldSendConversationStatus(
      { ...conversation("direct"), canSend: false },
      "hello",
      true,
      true,
      true,
    ),
    false,
  )
})

test("空白、失焦、页面隐藏或实时断线时不发送输入状态", () => {
  const direct = conversation("direct")
  assert.equal(shouldSendConversationStatus(direct, "   ", true, true, true), false)
  assert.equal(shouldSendConversationStatus(direct, "hello", false, true, true), false)
  assert.equal(shouldSendConversationStatus(direct, "hello", true, false, true), false)
  assert.equal(shouldSendConversationStatus(direct, "hello", true, true, false), false)
})

function conversation(type: DesktopConversation["type"]): DesktopConversation {
  return {
    id: "conversation-1",
    type,
    name: "对话",
    avatarType: type === "app" ? "app" : type === "group" ? "group" : "user",
    avatarId: "entity-1",
    memberCount: 2,
    createdAt: "2026-09-23T00:00:00Z",
    unreadCount: 0,
    lastMessageSummary: "",
    lastMessageAt: null,
    pinned: false,
    notificationMuted: false,
    isBuiltinAssistant: false,
  }
}
