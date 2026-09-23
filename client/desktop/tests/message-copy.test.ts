import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopMessage } from "../src/shared/account-data.ts"
import {
  resolveMessageBodyCopyPayload,
  resolveMessageCopyPayload,
} from "../src/renderer/features/chat/message-copy.ts"

test("消息复制优先使用选中文字", () => {
  assert.deepEqual(
    resolveMessageCopyPayload(
      message({ type: "link", title: "官网", url: "https://example.com" }),
      "选中的文字",
    ),
    {
      type: "text",
      text: "选中的文字",
    },
  )
})

test("合并聊天记录中的消息使用自己的摘要", () => {
  assert.deepEqual(
    resolveMessageBodyCopyPayload({ type: "text", content: "内层正文" }, "内层摘要", ""),
    { type: "text", text: "内层摘要" },
  )
})

test("图片、链接和普通消息使用对应复制内容", () => {
  assert.deepEqual(resolveMessageCopyPayload(message({ type: "image", fileId: "image-1" }), ""), {
    type: "image",
    fileId: "image-1",
  })
  assert.deepEqual(
    resolveMessageCopyPayload(
      message({ type: "link", title: "官网", url: "https://example.com" }),
      "",
    ),
    { type: "text", text: "https://example.com" },
  )
  assert.deepEqual(resolveMessageCopyPayload(message({ type: "text", content: "正文" }), ""), {
    type: "text",
    text: "消息摘要",
  })
})

function message(body: DesktopMessage["body"]): DesktopMessage {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    seq: 1,
    createdAt: "2026-09-23T00:00:00Z",
    senderId: "user-1",
    senderType: "user",
    senderName: "Alice",
    isMine: false,
    bodyType: body.type,
    content: "消息摘要",
    clientMessageId: "",
    body,
    reactions: [],
  }
}
