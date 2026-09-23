import assert from "node:assert/strict"
import test from "node:test"
import { createOutgoingTextMessageRequest } from "../src/main/account/outgoing-message-payload.ts"

test("回复消息请求携带目标消息 ID", () => {
  assert.deepEqual(
    createOutgoingTextMessageRequest({
      clientMessageId: "client-message-1",
      content: "回复内容",
      bodyType: "text",
      replyToMessageId: "message-1",
    }),
    {
      client_message_id: "client-message-1",
      reply_to_message_id: "message-1",
      body: { type: "text", content: "回复内容" },
    },
  )
})

test("普通消息请求不包含回复字段", () => {
  assert.deepEqual(
    createOutgoingTextMessageRequest({
      clientMessageId: "client-message-2",
      content: "https://example.com",
      bodyType: "link",
    }),
    {
      client_message_id: "client-message-2",
      body: { type: "link", url: "https://example.com" },
    },
  )
})
