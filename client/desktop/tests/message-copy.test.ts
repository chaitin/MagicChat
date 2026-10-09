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

test("Markdown 消息无选区时复制原文，有选区时只复制选中内容", () => {
  const markdown = "# 标题\n\n**加粗**与[链接](https://example.com)\n```ts\nconst a = 1\n```"
  const value = message({ type: "markdown", content: markdown }, "标题\n加粗与链接\nconst a = 1")
  assert.deepEqual(resolveMessageCopyPayload(value, ""), { type: "text", text: markdown })
  assert.deepEqual(resolveMessageCopyPayload(value, "加粗"), { type: "text", text: "加粗" })
  assert.deepEqual(
    resolveMessageBodyCopyPayload({ type: "markdown", content: markdown }, "摘要", ""),
    { type: "text", text: markdown },
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

test("带类型前缀的摘要复制时取原文", () => {
  assert.deepEqual(
    resolveMessageCopyPayload(
      message(
        { type: "file", fileId: "file-1", name: "报告.pdf", sizeBytes: 2048 },
        "[文件] 报告.pdf",
      ),
      "",
    ),
    { type: "text", text: "报告.pdf" },
  )
  assert.deepEqual(
    resolveMessageCopyPayload(
      message(
        {
          type: "voice",
          fileId: "file-2",
          sizeBytes: 512,
          durationMS: 3000,
          contentType: "audio/ogg",
          transcript: "你好",
        },
        "[语音] 你好",
      ),
      "",
    ),
    { type: "text", text: "你好" },
  )
  assert.deepEqual(
    resolveMessageCopyPayload(
      message(
        {
          type: "card",
          title: "周报",
          description: "本周进展",
          url: "https://example.com/report",
        },
        "[卡片] 周报",
      ),
      "",
    ),
    { type: "text", text: "周报" },
  )
})

function message(body: DesktopMessage["body"], content = "消息摘要"): DesktopMessage {
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
    content,
    clientMessageId: "",
    body,
    reactions: [],
  }
}
