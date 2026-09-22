import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import { groupConversationList } from "../src/renderer/features/chat/conversation-list-order.ts"

function conversation(
  id: string,
  lastMessageAt: string,
  overrides: Partial<DesktopConversation> = {},
): DesktopConversation {
  return {
    id,
    type: "group",
    name: id,
    memberCount: 2,
    avatarType: "group",
    avatarId: id,
    createdAt: "2026-09-22T08:00:00Z",
    lastMessageAt,
    lastMessageSummary: "",
    pinned: false,
    notificationMuted: false,
    isBuiltinAssistant: false,
    unreadCount: 0,
    ...overrides,
  }
}

function topic(id: string, parentConversationId: string, lastMessageAt: string) {
  return conversation(id, lastMessageAt, {
    type: "topic",
    topic: {
      archived: false,
      parentConversationId,
      participating: true,
      sourceSender: { id: "user-1", name: "Alice", type: "user" },
    },
  })
}

test("话题紧跟父会话并以组内最新活动排序", () => {
  const activeTopic = topic("topic-a", "parent-a", "2026-09-22T12:00:00Z")
  const olderTopic = topic("topic-a-old", "parent-a", "2026-09-22T11:00:00Z")
  const result = groupConversationList([
    conversation("parent-a", "2026-09-22T08:00:00Z"),
    conversation("parent-b", "2026-09-22T10:00:00Z"),
    olderTopic,
    activeTopic,
  ])

  assert.deepEqual(
    result.regular.map((item) => item.id),
    ["parent-a", "topic-a", "topic-a-old", "parent-b"],
  )
})

test("置顶父会话与其话题保持在置顶区域", () => {
  const result = groupConversationList([
    conversation("regular", "2026-09-22T12:00:00Z"),
    conversation("pinned", "2026-09-22T08:00:00Z", { pinned: true }),
    topic("pinned-topic", "pinned", "2026-09-22T09:00:00Z"),
  ])

  assert.deepEqual(
    result.pinned.map((item) => item.id),
    ["pinned", "pinned-topic"],
  )
  assert.deepEqual(
    result.regular.map((item) => item.id),
    ["regular"],
  )
})
