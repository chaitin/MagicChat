import assert from "node:assert/strict"
import test from "node:test"

import type { ClientConversation, ClientUser } from "@/core/models"
import { normalizeClientMessage } from "@/data/messages/message-normalizer"
import { buildPresentedMessages, collectMessageUserIds } from "@/domain/messages/message-presenter"
import { applyMessageReactionsUpdate } from "@/domain/messages/message-reactions"

function message() {
  return normalizeClientMessage({
    id: "message-1", conversation_id: "group-1", seq: 1,
    created_at: "2026-10-13T00:00:00Z", body: { type: "text", content: "hello" },
    sender: { type: "user", id: "user-1" }, reaction_version: 1,
    reactions: [{ text: "收到", count: 1, reacted_by_me: false, users: [{ id: "app-1", type: "app", name: "助手" }] }],
  })
}

test("收到回执保留应用身份，不把 App ID 当用户查询", () => {
  const value = message()
  assert.deepEqual(value.reactions[0].users, [{ id: "app-1", type: "app", name: "助手" }])
  assert.deepEqual(collectMessageUserIds([value]), ["user-1"])
})

test("应用回应更新不改变当前用户的回应状态", () => {
  const value = message()
  const result = applyMessageReactionsUpdate(value, {
    actorReacted: true, actorText: "收到", actorUserId: "", actorAppId: "app-1",
    conversationId: value.conversationId, messageId: value.id, reactionVersion: 2,
    reactions: [{ text: "收到", count: 1, users: value.reactions[0].users }],
  }, "app-1")
  assert.equal(result.status, "applied")
  assert.equal(result.message.reactions[0].reactedByMe, false)
  assert.equal(result.message.reactions[0].users[0].type, "app")
})

test("应用回执使用应用通讯录名称，不使用用户通讯录", () => {
  const currentUser: ClientUser = {
    id: "user-1", name: "User", nickname: "", email: "user@example.com", phone: "", avatar: "",
    createdAt: "2026-10-13T00:00:00Z", lastOnlineAt: null, status: "active",
  }
  const conversation: ClientConversation = {
    id: "group-1", type: "group", name: "Group", avatar: "", canSend: true,
    createdAt: "2026-10-13T00:00:00Z", lastChoiceSeq: 0, lastMentionedSeq: 0,
    lastMessageAt: null, lastMessageId: null, lastMessageSeq: 1, lastMessageSender: null,
    lastMessageSummary: "hello", lastReadSeq: 1, memberCount: 2, notificationMuted: false,
    pinned: false, unreadCount: 0, visibility: "private",
  }
  const presented = buildPresentedMessages({
    currentUser, conversation, messages: [message()], resolveMentionLabel: () => undefined,
    contacts: {
      apps: [{ id: "app-1", name: "最新助手名称", type: "app", avatar: "", description: "", creatorUserId: null, online: true }],
      users: [{ id: "app-1", name: "不是应用名称", nickname: "", type: "user", avatar: "", email: "", phone: "", lastOnlineAt: null, online: true }],
      groups: [],
    },
  })
  assert.equal(presented[0].reactions[0].users[0].name, "最新助手名称")
  assert.equal(presented[0].reactions[0].users[0].type, "app")
})
