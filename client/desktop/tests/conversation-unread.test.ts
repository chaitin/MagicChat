import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  conversationUnreadIndicator,
  hasUnreadMention,
  hasUnmutedUnreadConversations,
  unmutedUnreadCount,
} from "../src/renderer/features/chat/conversation-unread.ts"

test("无未读时隐藏提醒", () => {
  assert.equal(conversationUnreadIndicator({ unreadCount: 0, notificationMuted: false }), null)
  assert.equal(conversationUnreadIndicator({ unreadCount: 0, notificationMuted: true }), null)
})

test("普通会话显示未读数量，超过 99 显示 99+", () => {
  assert.deepEqual(conversationUnreadIndicator({ unreadCount: 1, notificationMuted: false }), {
    label: "1 条未读消息",
    text: "1",
  })
  assert.deepEqual(conversationUnreadIndicator({ unreadCount: 99, notificationMuted: false }), {
    label: "99 条未读消息",
    text: "99",
  })
  assert.deepEqual(conversationUnreadIndicator({ unreadCount: 100, notificationMuted: false }), {
    label: "100 条未读消息",
    text: "99+",
  })
})

test("免打扰会话有未读时只显示红点", () => {
  assert.deepEqual(conversationUnreadIndicator({ unreadCount: 100, notificationMuted: true }), {
    label: "有未读消息",
    text: null,
  })
})

test("选中会话始终隐藏未读徽标，新消息增加数量时也不闪现", () => {
  for (const notificationMuted of [false, true]) {
    for (const unreadCount of [0, 1, 2, 99, 100, 999]) {
      assert.equal(conversationUnreadIndicator({ unreadCount, notificationMuted }, true), null)
    }
  }
})

test("隐藏只影响列表显示，取消选中恢复徽标且不修改未读统计", () => {
  const conversation = Object.freeze({ unreadCount: 3, notificationMuted: false })
  assert.equal(conversationUnreadIndicator(conversation, true), null)
  const afterMessage = Object.freeze({ ...conversation, unreadCount: 4 })
  assert.equal(conversationUnreadIndicator(afterMessage, true), null)
  assert.deepEqual(conversationUnreadIndicator(afterMessage, false), {
    label: "4 条未读消息", text: "4",
  })
  assert.equal(conversation.unreadCount, 3)
  assert.equal(unmutedUnreadCount([afterMessage]), 4)
  assert.equal(hasUnmutedUnreadConversations([afterMessage]), true)
  assert.deepEqual(conversationUnreadIndicator({ ...afterMessage, notificationMuted: true }, false), {
    label: "有未读消息", text: null,
  })
})

test("对话列表将当前选中状态传给头像徽标显示规则", () => {
  const source = readFileSync(new URL("../src/renderer/features/chat/components/conversation-sidebar.tsx", import.meta.url), "utf8")
  assert.match(source, /<ConversationListAvatar\b[^>]*\bselected=\{active\}/)
  assert.match(source, /conversationUnreadIndicator\(conversation, selected\)/)
})

test("只有未读消息包含针对自己的提及时显示提及标记", () => {
  assert.equal(hasUnreadMention({ unreadCount: 2, lastReadSeq: 3, lastMentionedSeq: 5 }), true)
  assert.equal(hasUnreadMention({ unreadCount: 2, lastReadSeq: 5, lastMentionedSeq: 5 }), false)
  assert.equal(hasUnreadMention({ unreadCount: 0, lastReadSeq: 3, lastMentionedSeq: 5 }), false)
  assert.equal(hasUnreadMention({ unreadCount: 2, lastReadSeq: 3 }), false)
})

test("托盘未读数与聊天入口红点一致，仅累计非免打扰会话并封顶 99+", () => {
  const conversations = [
    { unreadCount: 4, notificationMuted: false },
    { unreadCount: 200, notificationMuted: true },
    { unreadCount: 3, notificationMuted: false },
    { unreadCount: Number.POSITIVE_INFINITY, notificationMuted: false },
  ]
  assert.equal(unmutedUnreadCount(conversations), 7)
  assert.equal(hasUnmutedUnreadConversations(conversations), true)
  assert.equal(unmutedUnreadCount([{ unreadCount: 99, notificationMuted: false }]), 99)
  assert.equal(
    unmutedUnreadCount([...conversations, { unreadCount: 99, notificationMuted: false }]),
    100,
  )
  assert.equal(unmutedUnreadCount([{ unreadCount: 6, notificationMuted: true }]), 0)
  assert.equal(unmutedUnreadCount([{ unreadCount: 0.5, notificationMuted: false }]), 1)
  assert.equal(unmutedUnreadCount([]), 0)
})

test("消息导航只在存在非免打扰的未读会话时显示红点", () => {
  assert.equal(hasUnmutedUnreadConversations([]), false)
  assert.equal(hasUnmutedUnreadConversations([{ unreadCount: 2, notificationMuted: true }]), false)
  assert.equal(
    hasUnmutedUnreadConversations([
      { unreadCount: 2, notificationMuted: true },
      { unreadCount: 0, notificationMuted: false },
    ]),
    false,
  )
  assert.equal(
    hasUnmutedUnreadConversations([
      { unreadCount: 2, notificationMuted: true },
      { unreadCount: 1, notificationMuted: false },
    ]),
    true,
  )
})
