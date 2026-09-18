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
