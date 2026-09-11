import { installTestAccountRuntime } from "./auth-runtime-test-helper.ts"
import assert from "node:assert/strict"
import test from "node:test"

import { fetchConversations } from "../src/data/conversations/conversations-api.ts"
import type {
  ClientContacts,
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "../src/core/models.ts"
import {
  isConversationTopicVisibleInList,
  orderConversations,
} from "../src/domain/conversations/conversation-order.ts"
import {
  buildConversationListItems,
  collectLatestConversationMessages,
  findLatestUnreadConversationIndex,
  formatUnreadCount,
  getBoundedConversationIds,
} from "../src/features/messages/conversation-list-model.ts"

const EMPTY_CONTACTS: ClientContacts = {
  apps: [],
  groups: [],
  users: [],
}

test("formats unread badge counts with a 99+ cap", () => {
  assert.equal(formatUnreadCount(99), "99")
  assert.equal(formatUnreadCount(100), "99+")
})

test("finds the most recently active unread conversation", () => {
  const items = buildConversationListItems({
    contacts: EMPTY_CONTACTS,
    conversations: [
      conversation({
        id: "older-pinned",
        lastMessageAt: "2026-07-30T07:00:00Z",
        pinned: true,
        unreadCount: 4,
      }),
      conversation({
        id: "latest-unread",
        lastMessageAt: "2026-07-30T07:55:00Z",
        unreadCount: 2,
      }),
    ],
    currentUserId: "current-user",
    keyword: "",
    now: new Date("2026-07-30T08:00:00Z"),
  })

  assert.equal(items[0]?.conversation.id, "older-pinned")
  assert.equal(findLatestUnreadConversationIndex(items), 1)
})

test("keeps topics under their parent and lets recent topic activity move the group", () => {
  const now = Date.parse("2026-07-30T08:00:00Z")
  const activeParent = conversation({
    id: "active-parent",
    lastMessageAt: "2026-07-30T06:00:00Z",
    name: "活跃父会话",
    type: "group",
  })
  const recentParent = conversation({
    id: "recent-parent",
    lastMessageAt: "2026-07-30T07:53:00Z",
    name: "最近父会话",
    type: "group",
  })
  const newestTopic = topicConversation({
    id: "newest-topic",
    lastMessageAt: "2026-07-30T07:55:00Z",
    parent: activeParent,
  })
  const olderTopic = topicConversation({
    id: "older-topic",
    lastMessageAt: "2026-07-30T07:50:00Z",
    parent: activeParent,
  })

  assert.deepEqual(
    orderConversations(
      [recentParent, olderTopic, activeParent, newestTopic],
      now
    ).map(({ id }) => id),
    ["active-parent", "newest-topic", "older-topic", "recent-parent"]
  )
})

test("shows only participating, open, active or unread topics", () => {
  const now = Date.parse("2026-07-30T08:00:00Z")
  const parent = conversation({ id: "parent", type: "group" })
  const stale = topicConversation({
    id: "stale",
    lastMessageAt: "2026-07-30T07:29:59Z",
    parent,
  })
  const unread = {
    ...stale,
    id: "unread",
    lastMessageSeq: 2,
    unreadCount: 1,
  }

  assert.equal(isConversationTopicVisibleInList(stale, { now }), false)
  assert.equal(isConversationTopicVisibleInList(unread, { now }), true)
  assert.equal(
    isConversationTopicVisibleInList(stale, {
      activeConversationId: stale.id,
      now,
    }),
    true
  )
  assert.equal(
    isConversationTopicVisibleInList({
      ...unread,
      topic: { ...unread.topic!, archived: true },
    }),
    false
  )
  assert.equal(
    isConversationTopicVisibleInList({
      ...unread,
      topic: { ...unread.topic!, participating: false },
    }),
    false
  )
})

test("builds nested topic rows and omits stale, archived, and orphan topics", () => {
  const now = new Date("2026-07-30T08:00:00Z")
  const parent = conversation({
    id: "parent",
    name: "产品群",
    pinned: true,
    type: "group",
  })
  const recent = topicConversation({
    id: "recent",
    lastMessageAt: "2026-07-30T07:55:00Z",
    name: "发布计划",
    parent,
  })
  const stale = topicConversation({
    id: "stale",
    lastMessageAt: "2026-07-30T07:20:00Z",
    parent,
  })
  const archived = topicConversation({
    archived: true,
    id: "archived",
    lastMessageAt: "2026-07-30T07:59:00Z",
    parent,
  })
  const orphan = topicConversation({
    id: "orphan",
    lastMessageAt: "2026-07-30T07:58:00Z",
    parent: conversation({ id: "missing", type: "group" }),
  })

  const items = buildConversationListItems({
    contacts: EMPTY_CONTACTS,
    conversations: [stale, archived, orphan, recent, parent],
    currentUserId: "me",
    keyword: "",
    now,
  })

  assert.deepEqual(
    items.map(({ conversation: item, nested, pinnedBackground }) => [
      item.id,
      nested,
      pinnedBackground,
    ]),
    [
      ["parent", false, true],
      ["recent", true, true],
    ]
  )

  const matchingItems = buildConversationListItems({
    contacts: EMPTY_CONTACTS,
    conversations: [recent, parent],
    currentUserId: "me",
    keyword: "发布计划",
    now,
  })
  assert.deepEqual(
    matchingItems.map(({ conversation: item }) => item.id),
    ["parent", "recent"]
  )
})

test("prefixes senders only for groups and group topics", () => {
  const now = new Date("2026-07-30T08:00:00Z")
  const group = conversation({
    id: "group",
    lastMessageSender: sender("user-2", "张三", "小张"),
    lastMessageSummary: "群聊消息",
    members: [{
      avatar: "",
      email: "",
      id: "user-2",
      name: "张三",
      nickname: "小张",
      phone: "",
      role: "member",
      type: "user",
    }],
    name: "产品群",
    type: "group",
  })
  const app = conversation({
    id: "app",
    lastMessageSender: sender("app-1", "助手"),
    lastMessageSummary: "应用消息",
    name: "助手",
    type: "app",
  })
  const groupTopic = topicConversation({
    id: "group-topic",
    lastMessageAt: "2026-07-30T07:59:00Z",
    lastMessageSender: sender("user-2", "张三", "小张"),
    lastMessageSummary: "话题回复",
    parent: group,
  })
  const appTopic = topicConversation({
    id: "app-topic",
    lastMessageAt: "2026-07-30T07:58:00Z",
    lastMessageSender: sender("user-2", "张三", "小张"),
    lastMessageSummary: "应用话题回复",
    parent: app,
  })

  const descriptions = new Map(
    buildConversationListItems({
      contacts: EMPTY_CONTACTS,
      conversations: [appTopic, groupTopic, app, group],
      currentUserId: "me",
      keyword: "",
      latestMessages: new Map([
        [group.id, message(group.id, "群聊消息", "user-2")],
        [app.id, message(app.id, "应用消息", "app-1")],
        [groupTopic.id, message(groupTopic.id, "话题回复", "user-2")],
        [appTopic.id, message(appTopic.id, "应用话题回复", "user-2")],
      ]),
      now,
    }).map((item) => [item.conversation.id, item.description])
  )

  assert.equal(descriptions.get("group"), "小张：群聊消息")
  assert.equal(descriptions.get("group-topic"), "小张：话题回复")
  assert.equal(descriptions.get("app"), "应用消息")
  assert.equal(descriptions.get("app-topic"), "应用话题回复")
})

test("bounds visible conversation hydration without excluding later rows", () => {
  const items = buildConversationListItems({
    contacts: EMPTY_CONTACTS,
    conversations: Array.from({ length: 40 }, (_, index) =>
      conversation({
        createdAt: new Date(Date.UTC(2026, 6, 30, 0, index)).toISOString(),
        id: `conversation-${index}`,
        lastMessageAt: new Date(Date.UTC(2026, 6, 30, 0, index)).toISOString(),
      })
    ),
    currentUserId: "me",
    keyword: "",
  })

  const laterVisibleRows = items.slice(30)
  assert.deepEqual(getBoundedConversationIds(laterVisibleRows, 3), [
    "conversation-9",
    "conversation-8",
    "conversation-7",
  ])
})

test("uses only cached messages for conversation summaries", () => {
  const item = buildConversationListItems({
    contacts: EMPTY_CONTACTS,
    conversations: [conversation({ lastMessageSummary: "服务端摘要" })],
    currentUserId: "me",
    keyword: "",
  })[0]

  assert.equal(item?.description, "暂无消息")
})

test("selects the highest-sequence cached message across all query pages", () => {
  const older = { id: "older", seq: 7 } as ClientMessage
  const latest = { id: "latest", seq: 11 } as ClientMessage
  const selected = collectLatestConversationMessages([
    {
      conversationId: "conversation",
      pages: [
        { messages: [older], page: {} as ClientMessageList["page"] },
        { messages: [latest], page: {} as ClientMessageList["page"] },
      ],
    },
  ])

  assert.equal(selected.get("conversation"), latest)
})

test("normalizes the last message sender from the conversation API", async () => {
  const conversations = await fetchConversations(installTestAccountRuntime({ id: "server-1", url: "https://example.com", userId: "user-1" }), {
    fetcher: async () =>
      new Response(
        JSON.stringify({
          data: {
            conversations: [
              {
                created_at: "2026-07-30T00:00:00Z",
                id: "group",
                last_message_sender: {
                  id: "user-2",
                  name: "张三",
                  nickname: "小张",
                  type: "user",
                },
                name: "产品群",
                type: "group",
              },
            ],
          },
          success: true,
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      ),
  })

  assert.deepEqual(conversations[0]?.lastMessageSender, {
    id: "user-2",
    name: "张三",
    nickname: "小张",
    type: "user",
  })
})

function conversation(
  overrides: Partial<ClientConversation> = {}
): ClientConversation {
  return {
    avatar: "",
    canSend: true,
    createdAt: "2026-07-30T00:00:00Z",
    id: "conversation",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: "2026-07-30T00:00:00Z",
    lastMessageId: null,
    lastMessageSender: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastReadSeq: 0,
    memberCount: 0,
    name: "会话",
    notificationMuted: false,
    pinned: false,
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}

function topicConversation({
  archived = false,
  id,
  lastMessageAt,
  lastMessageSender = null,
  lastMessageSummary = "",
  name = id,
  parent,
}: {
  archived?: boolean
  id: string
  lastMessageAt: string
  lastMessageSender?: ClientConversation["lastMessageSender"]
  lastMessageSummary?: string
  name?: string
  parent: ClientConversation
}) {
  return conversation({
    id,
    lastMessageAt,
    lastMessageSender,
    lastMessageSummary,
    name,
    topic: {
      archived,
      parentConversationId: parent.id,
      parentConversationName: parent.name,
      parentConversationType:
        parent.type === "topic" ? "group" : parent.type,
      participating: true,
      sourceMessageId: `source-${id}`,
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "",
        id: "user-2",
        name: "张三",
        type: "user",
      },
    },
    type: "topic",
  })
}

function sender(id: string, name: string, nickname = "") {
  return { id, name, nickname, type: "user" as const }
}

function message(
  conversationId: string,
  text: string,
  senderId: string
): ClientMessage {
  return {
    body: { content: text, type: "text" },
    clientMessageId: `client-${conversationId}`,
    conversationId,
    createdAt: "2026-07-30T08:00:00Z",
    id: `message-${conversationId}`,
    reactionVersion: 0,
    reactions: [],
    sender: {
      id: senderId,
      type: senderId.startsWith("app") ? "app" : "user",
    },
    seq: 1,
  }
}
