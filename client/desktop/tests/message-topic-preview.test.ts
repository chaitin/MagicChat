import assert from "node:assert/strict"
import test from "node:test"
import { normalizeDesktopMessageDetails } from "../src/main/account/message-normalizer.ts"

test("解析话题最近三条有效回复", () => {
  const details = normalizeDesktopMessageDetails({
    body: { type: "text", content: "发起话题" },
    topic: {
      archived: true,
      conversation_id: "topic-1",
      recent_replies: [
        {
          id: "reply-0",
          created_at: "2026-09-22T09:59:00Z",
          sender: { id: "system", type: "system" },
          summary: "忽略系统消息",
        },
        ...[1, 2, 3, 4].map((index) => ({
          id: `reply-${index}`,
          created_at: `2026-09-22T10:0${index}:00Z`,
          sender: { id: `sender-${index}`, type: index === 4 ? "app" : "user" },
          summary: `回复 ${index}`,
        })),
      ],
    },
  })

  assert.deepEqual(details.topic, {
    archived: true,
    conversationId: "topic-1",
    recentReplies: [
      {
        id: "reply-2",
        createdAt: "2026-09-22T10:02:00Z",
        senderId: "sender-2",
        senderType: "user",
        summary: "回复 2",
      },
      {
        id: "reply-3",
        createdAt: "2026-09-22T10:03:00Z",
        senderId: "sender-3",
        senderType: "user",
        summary: "回复 3",
      },
      {
        id: "reply-4",
        createdAt: "2026-09-22T10:04:00Z",
        senderId: "sender-4",
        senderType: "app",
        summary: "回复 4",
      },
    ],
  })
})
