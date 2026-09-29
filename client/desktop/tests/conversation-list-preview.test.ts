import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import { formatConversationSummary } from "../src/renderer/features/chat/conversation-list-preview.ts"

const noMentions = () => undefined

function conversation(overrides: Partial<DesktopConversation> = {}): DesktopConversation {
  return {
    id: "conversation-1",
    type: "group",
    name: "产品群",
    memberCount: 3,
    avatarType: "group",
    avatarId: "conversation-1",
    createdAt: "2026-09-22T12:00:00Z",
    lastMessageAt: "2026-09-22T12:30:00Z",
    lastMessageSummary: "今天的评审推迟到明天",
    pinned: false,
    notificationMuted: false,
    isBuiltinAssistant: false,
    unreadCount: 0,
    ...overrides,
  }
}

test("群聊摘要展示发送者", () => {
  assert.equal(
    formatConversationSummary(
      conversation({
        lastMessageSender: { id: "user-2", name: "李四", type: "user" },
      }),
      noMentions,
      "user-1",
    ),
    "李四：今天的评审推迟到明天",
  )
})

test("自己发送的群消息显示为我", () => {
  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "USER-1", name: "张三", type: "user" } }),
      noMentions,
      "user-1",
    ),
    "我：今天的评审推迟到明天",
  )
})

test("发送者名字优先按通讯录现查", () => {
  const contacts: Record<string, string> = { "user-2": "李四（备注）", "app-1": "日报助手" }
  const resolveContacts = (target: { id: string; type: "user" | "app" | "all" }) =>
    contacts[target.id]

  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "user-2", name: "李四", type: "user" } }),
      resolveContacts,
      "user-1",
    ),
    "李四（备注）：今天的评审推迟到明天",
  )
  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "app-1", name: "旧应用名", type: "app" } }),
      resolveContacts,
      "user-1",
    ),
    "日报助手：今天的评审推迟到明天",
  )
  // 通讯录里查不到时回退到消息里存的名字。
  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "user-9", name: "王五", type: "user" } }),
      resolveContacts,
      "user-1",
    ),
    "王五：今天的评审推迟到明天",
  )
  // 两边都拿不到名字时只展示摘要。
  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "user-8", name: "", type: "user" } }),
      resolveContacts,
      "user-1",
    ),
    "今天的评审推迟到明天",
  )
})

test("系统消息不展示发送者前缀", () => {
  assert.equal(
    formatConversationSummary(
      conversation({
        lastMessageSummary: "李四 加入群聊",
        lastMessageSender: { id: "", name: "系统", type: "system" },
      }),
      noMentions,
      "user-1",
    ),
    "李四 加入群聊",
  )
})

test("应用发送者展示应用名", () => {
  assert.equal(
    formatConversationSummary(
      conversation({ lastMessageSender: { id: "app-1", name: "日报助手", type: "app" } }),
      noMentions,
      "user-1",
    ),
    "日报助手：今天的评审推迟到明天",
  )
})

test("群内话题同样展示发送者，单聊不展示", () => {
  assert.equal(
    formatConversationSummary(
      conversation({
        type: "topic",
        topic: {
          archived: false,
          parentConversationId: "group-1",
          parentConversationType: "group",
          participating: true,
          sourceSender: { id: "user-2", name: "李四", type: "user" },
        },
        lastMessageSender: { id: "user-2", name: "李四", type: "user" },
      }),
      noMentions,
      "user-1",
    ),
    "李四：今天的评审推迟到明天",
  )
  assert.equal(
    formatConversationSummary(
      conversation({
        type: "direct",
        lastMessageSender: { id: "user-2", name: "李四", type: "user" },
      }),
      noMentions,
      "user-1",
    ),
    "今天的评审推迟到明天",
  )
})

test("没有发送者信息或没有消息时回退", () => {
  assert.equal(
    formatConversationSummary(conversation(), noMentions, "user-1"),
    "今天的评审推迟到明天",
  )
  assert.equal(
    formatConversationSummary(
      conversation({
        lastMessageSummary: "",
        lastMessageSender: { id: "user-2", name: "李四", type: "user" },
      }),
      noMentions,
      "user-1",
    ),
    "暂无消息",
  )
})
