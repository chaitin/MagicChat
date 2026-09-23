import assert from "node:assert/strict"
import test from "node:test"
import {
  conversationUnreadIndicator,
  hasUnmutedUnreadConversations,
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

test("消息导航只在存在非免打扰的未读会话时显示红点", () => {
  assert.equal(hasUnmutedUnreadConversations([]), false)
  assert.equal(hasUnmutedUnreadConversations([{ unreadCount: 2, notificationMuted: true }]), false)
  assert.equal(hasUnmutedUnreadConversations([
    { unreadCount: 2, notificationMuted: true },
    { unreadCount: 0, notificationMuted: false },
  ]), false)
  assert.equal(hasUnmutedUnreadConversations([
    { unreadCount: 2, notificationMuted: true },
    { unreadCount: 1, notificationMuted: false },
  ]), true)
})
