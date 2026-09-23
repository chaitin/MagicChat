import assert from "node:assert/strict"
import test from "node:test"
import { canPinConversation } from "../src/renderer/features/chat/conversation-action-policy.ts"

test("普通会话允许置顶，话题和内置助手不允许置顶", () => {
  assert.equal(canPinConversation({ type: "direct", isBuiltinAssistant: false }), true)
  assert.equal(canPinConversation({ type: "group", isBuiltinAssistant: false }), true)
  assert.equal(canPinConversation({ type: "topic", isBuiltinAssistant: false }), false)
  assert.equal(canPinConversation({ type: "app", isBuiltinAssistant: true }), false)
})
