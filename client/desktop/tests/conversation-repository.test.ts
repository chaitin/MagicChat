import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { initializeAccountSchema } from "../src/main/account/database/account-schema.ts"
import { ConversationRepository } from "../src/main/account/database/conversation-repository.ts"

function conversation(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "group",
    name: id,
    memberCount: 2,
    avatar: "",
    avatarType: "group" as const,
    avatarId: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: null,
    lastMessageSummary: "",
    pinned: false,
    notificationMuted: false,
    isBuiltinAssistant: false,
    unreadCount: 0,
    payload: {},
    ...overrides,
  }
}

test("消息序号和已读事件幂等推进，旧快照不会恢复未读", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  repository.upsertCurrent([conversation("group-1", { lastMessageSeq: 4, lastReadSeq: 2, unreadCount: 2 })])
  repository.applyMessageSeq("group-1", 5, false)
  repository.applyMessageSeq("group-1", 5, false)
  assert.equal(repository.list()[0].unreadCount, 3)
  repository.applyReadSeq("group-1", 4)
  repository.applyReadSeq("group-1", 2)
  assert.equal(repository.list()[0].unreadCount, 1)
  repository.upsertCurrent([conversation("group-1", { lastMessageSeq: 4, lastReadSeq: 2, unreadCount: 2 })])
  assert.deepEqual(
    [repository.list()[0].lastMessageSeq, repository.list()[0].lastReadSeq, repository.list()[0].unreadCount],
    [5, 4, 1],
  )
  repository.applyMessageSeq("group-1", 6, true)
  assert.equal(repository.list()[0].unreadCount, 0)
  database.close()
})

test("会话仓储稳定读取最后一条消息", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  repository.upsertCurrent([conversation("group-1")])
  const insert = database.prepare(`
    INSERT INTO messages (
      conversation_id, id, seq, created_at, sender_id, sender_type, sender_name,
      body_type, content, client_message_id, delivery_status, payload_json
    ) VALUES (?, ?, ?, ?, '', 'user', '', 'text', ?, '', '', '{}')
  `)
  insert.run("group-1", "older", 1, "2026-01-01T00:00:00.000Z", "较早消息")
  insert.run("group-1", "newer", 1, "2026-01-01T00:01:00.000Z", "较新消息")

  const [stored] = repository.list()
  assert.equal(stored.lastMessageSummary, "较新消息")
  assert.equal(stored.memberCount, 2)
  database.close()
})

test("会话列表保留历史普通会话并过滤长期无活动的已读话题", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  const now = new Date("2026-09-22T12:00:00.000Z")
  repository.upsertCurrent([
    conversation("older-group", {
      createdAt: "2026-01-01T00:00:00.000Z",
      lastMessageAt: "2026-01-01T00:00:00.000Z",
    }),
    conversation("stale-topic", {
      type: "topic",
      lastMessageAt: "2026-09-22T11:29:59.000Z",
    }),
    conversation("unread-topic", {
      type: "topic",
      lastMessageAt: "2026-09-22T11:00:00.000Z",
      unreadCount: 1,
    }),
    conversation("recent-topic", {
      type: "topic",
      lastMessageAt: "2026-09-22T11:30:00.000Z",
    }),
  ])

  repository.upsertCurrent([conversation("latest-group", { lastMessageAt: now.toISOString() })])

  assert.deepEqual(
    repository.list(now).map((item) => item.id),
    ["latest-group", "recent-topic", "unread-topic", "older-group"],
  )
  assert.equal(repository.hasCurrent("stale-topic"), true)
  assert.notEqual(repository.getPayload("stale-topic"), undefined)
  database.close()
})

test("已读后的旧话题仅在仍被选中时留在列表，移除后不再显示", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  const now = new Date("2026-09-22T12:00:00.000Z")
  repository.upsertCurrent([
    conversation("old-topic", {
      type: "topic",
      lastMessageAt: "2026-09-22T11:00:00.000Z",
      lastMessageSeq: 1,
      lastReadSeq: 0,
      unreadCount: 1,
    }),
  ])
  assert.deepEqual(
    repository.list(now).map((item) => item.id),
    ["old-topic"],
  )

  repository.applyReadSeq("old-topic", 1)
  assert.deepEqual(
    repository.list(now).map((item) => item.id),
    [],
  )
  assert.deepEqual(
    repository.list(now, "old-topic").map((item) => item.id),
    ["old-topic"],
  )
  assert.deepEqual(
    repository.list(now, "another-topic").map((item) => item.id),
    [],
  )

  repository.removeCurrent("old-topic")
  assert.deepEqual(
    repository.list(now, "old-topic").map((item) => item.id),
    [],
  )
  database.close()
})

test("会话仓储解析话题父会话和发起人", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  repository.upsertCurrent([
    conversation("topic-1", {
      type: "topic",
      unreadCount: 1,
      avatarId: "parent-1",
      payload: {
        id: "topic-1",
        type: "topic",
        topic: {
          archived: false,
          parent_conversation_id: "parent-1",
          participating: true,
          source_sender: { id: "user-1", name: "Alice", type: "user" },
        },
      },
    }),
  ])

  assert.deepEqual(repository.list()[0].topic, {
    archived: false,
    parentConversationId: "parent-1",
    participating: true,
    sourceSender: { id: "user-1", name: "Alice", type: "user" },
  })
  database.close()
})

test("可见性修复恢复被快照同步误隐藏的普通会话", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  repository.upsertCurrent([
    conversation("hidden-group"),
    conversation("hidden-topic", { type: "topic" }),
  ])
  database.exec("UPDATE conversations SET current = 0")
  database.exec("DELETE FROM metadata WHERE key = 'parent_conversation_visibility_v3'")

  initializeAccountSchema(database)

  assert.equal(repository.hasCurrent("hidden-group"), true)
  assert.equal(repository.hasCurrent("hidden-topic"), false)
  database.close()
})

test("可见性迁移只执行一次并恢复旧会话", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new ConversationRepository(database)
  repository.upsertCurrent([conversation("legacy")])
  database.exec("UPDATE conversations SET current = 0")
  database.exec("DELETE FROM metadata WHERE key = 'conversation_visibility_v2'")

  initializeAccountSchema(database)
  assert.equal(repository.hasCurrent("legacy"), true)

  database.exec("UPDATE conversations SET current = 0")
  initializeAccountSchema(database)
  assert.equal(repository.hasCurrent("legacy"), false)
  database.close()
})
