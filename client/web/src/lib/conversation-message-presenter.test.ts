import { describe, expect, it } from "vitest"

import type {
  ClientConversation,
  ClientMessage,
  ContactUser,
} from "@/lib/client-data-api"
import {
  formatConversationMessageTime,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"

it("uses resolved group-member profiles outside the contact list", () => {
  const member: ContactUser = {
    avatar: "https://example.test/member.png",
    email: "member@example.test",
    id: "member-id",
    lastOnlineAt: null,
    name: "群成员姓名",
    nickname: "群成员昵称",
    online: false,
    phone: "",
    type: "user",
  }
  const message = {
    body: { content: "你好", type: "text" },
    clientMessageId: "client-message-id",
    conversationId: "group-id",
    createdAt: "2026-07-16T09:05:00",
    id: "message-id",
    reactionVersion: 0,
    reactions: [],
    sender: { id: member.id, type: "user" },
    seq: 1,
  } as ClientMessage
  const conversation: ClientConversation = {
    avatar: "",
    createdAt: "2026-07-16T09:00:00",
    id: "group-id",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSender: null,
    lastMessageSeq: 1,
    lastMessageSummary: "你好",
    lastReadSeq: 0,
    memberCount: 2,
    members: [],
    name: "群聊",
    type: "group",
    unreadCount: 1,
    visibility: "private",
  }

  const presented = toConversationPanelMessage(
    message,
    conversation,
    { avatar: "", id: "current-user", name: "当前用户", nickname: "" },
    { [member.id]: member },
    new Map(),
    new Map([[message.id, message]]),
    () => undefined
  )

  expect(presented.author).toBe("群成员昵称")
  expect(presented.avatar).toBe(member.avatar)
})

describe("formatConversationMessageTime", () => {
  const now = new Date("2026-07-16T20:00:00")

  it("shows only the time for messages from today", () => {
    expect(formatConversationMessageTime("2026-07-16T09:05:00", now)).toBe(
      "09:05"
    )
  })

  it("adds month and day for historical messages from this year", () => {
    expect(formatConversationMessageTime("2026-01-02T09:05:00", now)).toBe(
      "01/02 09:05"
    )
  })

  it("adds the year for historical messages from another year", () => {
    expect(formatConversationMessageTime("2025-12-31T23:59:00", now)).toBe(
      "2025/12/31 23:59"
    )
  })

  it("returns an empty string for invalid timestamps", () => {
    expect(formatConversationMessageTime("not-a-date", now)).toBe("")
  })
})
