import assert from "node:assert/strict"
import test from "node:test"
import { normalizeDesktopMessageDetails } from "../src/main/account/message-normalizer.ts"
import { createOutgoingTextMessageRequest } from "../src/main/account/outgoing-message-payload.ts"
import { getDesktopMessageReplyAuthor } from "../src/renderer/features/chat/message-actions.ts"

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

test("引用用户消息时通过用户 ID 显示姓名，而不是暴露 ID", () => {
  const reply = normalizeDesktopMessageDetails({
    body: { type: "text", content: "回复内容" },
    reply_to: {
      id: "message-1",
      sender: { type: "user", id: "user-1" },
      summary: "原消息",
    },
  }).replyTo
  assert.deepEqual(reply, {
    id: "message-1",
    senderId: "user-1",
    senderType: "user",
    author: "未知用户",
    summary: "原消息",
  })
  assert.ok(reply)
  assert.equal(
    getDesktopMessageReplyAuthor(reply, ({ id, type }) =>
      type === "user" && id === "user-1" ? "张三" : undefined,
    ),
    "张三",
  )
  assert.equal(
    getDesktopMessageReplyAuthor(reply, () => undefined),
    "未知用户",
  )
  assert.equal(
    getDesktopMessageReplyAuthor({ ...reply, author: "user-1" }, () => undefined),
    "未知用户",
  )
})

test("引用应用消息沿用应用名称，旧引用仍能显示已有作者名", () => {
  const reply = normalizeDesktopMessageDetails({
    body: { type: "text", content: "回复内容" },
    reply_to: { id: "message-2", sender: { type: "app", id: "app-1", name: "天气助手" } },
  }).replyTo
  assert.ok(reply)
  assert.equal(
    getDesktopMessageReplyAuthor(reply, () => undefined),
    "天气助手",
  )
  assert.equal(
    getDesktopMessageReplyAuthor(
      { id: "legacy", author: "李四", summary: "消息" },
      () => undefined,
    ),
    "李四",
  )
})
