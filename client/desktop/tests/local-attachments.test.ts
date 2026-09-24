import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { initializeAccountSchema } from "../src/main/account/database/account-schema.ts"
import { MessageRepository } from "../src/main/account/database/message-repository.ts"

test("历史附件只读取本地文件消息且按序分页，忽略撤回和其他会话", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new MessageRepository(database)
  const insertConversation = database.prepare(`INSERT INTO conversations (
    id, type, name, member_count, avatar, avatar_type, avatar_id, created_at,
    last_message_summary, pinned, notification_muted, is_builtin_assistant,
    unread_count, current, payload_json
  ) VALUES (?, 'group', '', 1, '', 'group', ?, '2026-01-01T00:00:00Z',
    '', 0, 0, 0, 0, 1, '{}')`)
  insertConversation.run("group-1", "group-1")
  insertConversation.run("group-2", "group-2")
  const insert = database.prepare(`INSERT INTO messages (
    conversation_id, id, seq, created_at, sender_id, sender_type, sender_name,
    body_type, content, client_message_id, delivery_status, payload_json
  ) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', 'alice', 'user', 'Alice', ?, '', '', '', ?)`)
  const file = (id: string, name = `${id}.pdf`) =>
    JSON.stringify({ body: { type: "file", file_id: id, name, size_bytes: 100 } })
  insert.run("group-1", "first", 1, "file", file("f1"))
  insert.run("group-1", "second", 2, "file", file("f2"))
  insert.run("group-1", "revoked", 3, "revoked", file("f3"))
  insert.run("group-2", "foreign", 4, "file", file("f4"))
  assert.deepEqual(
    repository.listAttachments("group-1", 0).items.map((item) => [item.id, item.body.fileId]),
    [
      ["second", "f2"],
      ["first", "f1"],
    ],
  )
  assert.deepEqual(
    repository.listAttachments("group-1", 1).items.map((item) => item.id),
    ["first"],
  )
  for (let seq = 5; seq < 55; seq += 1) {
    insert.run("group-1", `file-${seq}`, seq, "file", file(`f${seq}`))
  }
  const firstPage = repository.listAttachments("group-1", 0)
  assert.equal(firstPage.items.length, 50)
  assert.equal(firstPage.nextOffset, 50)
  const secondPage = repository.listAttachments("group-1", firstPage.nextOffset!)
  assert.deepEqual(
    secondPage.items.map((item) => item.id),
    ["second", "first"],
  )
  assert.equal(secondPage.nextOffset, null)
  insert.run("group-1", "named", 1, "file", file("f55", "预算 REPORT_%.pdf"))
  assert.deepEqual(
    repository.listAttachments("group-1", 0, "report_%").items.map((item) => item.id),
    ["named"],
  )
  assert.deepEqual(
    repository.listAttachments("group-1", 0, "预算").items.map((item) => item.id),
    ["named"],
  )
  assert.deepEqual(repository.listAttachments("group-2", 0, "report_%").items, [])
  const filteredPage = repository.listAttachments("group-1", 0, ".PDF")
  assert.equal(filteredPage.nextOffset, 50)
  assert.equal(repository.listAttachments("group-1", 50, ".pdf").items.length, 3)
  assert.equal(repository.listAttachments("group-1", 0, "missing").nextOffset, null)
  assert.equal(repository.getAttachmentMessageSeq("group-1", "named"), 1)
  assert.equal(repository.getAttachmentMessageSeq("group-2", "named"), null)
  assert.ok(
    repository.listMessages("group-1", "alice", 50, 27).some((message) => message.id === "named"),
  )
  assert.deepEqual(
    repository.listMessages("group-1", "alice", 3, undefined, 2).map((message) => message.id),
    ["revoked", "file-5", "file-6"],
  )
  const newer = repository.listMessages("group-1", "alice", 51, undefined, 1)
  assert.equal(newer.length, 51)
  assert.equal(newer[0]?.id, "second")
  assert.equal(newer.at(-1)?.id, "file-53")
  assert.equal(repository.hasMessagesAfter("group-1", newer.at(-1)!.seq), true)
  assert.equal(repository.hasMessagesAfter("group-1", 54), false)
  database.close()
})

test("搜索到最近 50 条之外的文字消息仍可从本地读取上下文", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const repository = new MessageRepository(database)
  database
    .prepare(
      `INSERT INTO conversations (
    id, type, name, member_count, avatar, avatar_type, avatar_id, created_at,
    last_message_summary, pinned, notification_muted, is_builtin_assistant,
    unread_count, current, payload_json
  ) VALUES ('group-1', 'group', '', 1, '', 'group', 'group-1',
    '2026-01-01T00:00:00Z', '', 0, 0, 0, 0, 1, '{}')`,
    )
    .run()
  const insert = database.prepare(`INSERT INTO messages (
    conversation_id, id, seq, created_at, sender_id, sender_type, sender_name,
    body_type, content, client_message_id, delivery_status, payload_json
  ) VALUES ('group-1', ?, ?, '2026-01-01T00:00:00Z', 'alice', 'user', 'Alice',
    'text', ?, '', '', ?)`)
  for (let seq = 1; seq <= 60; seq++) {
    insert.run(
      `text-${seq}`,
      seq,
      `消息 ${seq}`,
      JSON.stringify({ body: { type: "text", content: `消息 ${seq}` } }),
    )
  }
  assert.equal(
    repository.listMessages("group-1", "alice", 50).some((message) => message.id === "text-5"),
    false,
  )
  assert.equal(repository.getMessageSeq("group-1", "text-5"), 5)
  assert.equal(repository.getAttachmentMessageSeq("group-1", "text-5"), null)
  assert.equal(repository.getMessageSeq("group-2", "text-5"), null)
  const context = repository.listMessages("group-1", "alice", 50, 31)
  assert.ok(context.some((message) => message.id === "text-5"))
  assert.equal(repository.hasMessagesAfter("group-1", context.at(-1)!.seq), true)
  const before = repository.listMessages("group-1", "alice", 20, 30)
  const target = repository.listMessages("group-1", "alice", 1, 31)
  const after = repository.listMessages("group-1", "alice", 20, undefined, 30)
  assert.equal(before[0]?.id, "text-10")
  assert.equal(target[0]?.id, "text-30")
  assert.equal(after.at(-1)?.id, "text-50")
  assert.equal(before.length + target.length + after.length, 41)
  database.close()
})
