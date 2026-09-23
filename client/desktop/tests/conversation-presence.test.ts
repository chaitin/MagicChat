import assert from "node:assert/strict"
import test from "node:test"
import { parseConversationPresenceEvent } from "../src/main/account/conversation-presence.ts"

test("解析收到的对话输入状态", () => {
  assert.deepEqual(
    parseConversationPresenceEvent("account-1", "conversation.status", {
      conversation_id: "conversation-1",
      status: "正在输入",
      sender: { id: "app-1", type: "app" },
    }),
    {
      targetId: "account-1",
      name: "conversation.status",
      conversationId: "conversation-1",
      status: "正在输入",
      sender: { id: "app-1", type: "app" },
    },
  )
})

test("解析新消息发送者用于立即清除输入状态", () => {
  assert.deepEqual(
    parseConversationPresenceEvent("account-1", "message.created", {
      message: {
        conversation_id: "conversation-1",
        sender: { id: "user-2", type: "user" },
      },
    }),
    {
      targetId: "account-1",
      name: "message.created",
      conversationId: "conversation-1",
      sender: { id: "user-2", type: "user" },
    },
  )
})

test("拒绝结构不完整的输入状态", () => {
  assert.equal(
    parseConversationPresenceEvent("account-1", "conversation.status", {
      conversation_id: "conversation-1",
      status: "正在输入",
      sender: { id: "", type: "app" },
    }),
    null,
  )
})

test("忽略不能用于输入状态的系统消息发送者", () => {
  assert.equal(
    parseConversationPresenceEvent("account-1", "message.created", {
      message: {
        conversation_id: "conversation-1",
        sender: { id: "system", type: "system" },
      },
    }),
    null,
  )
})
