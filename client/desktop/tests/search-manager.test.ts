import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { initializeAccountSchema } from "../src/main/account/database/account-schema.ts"
import { SearchRepository } from "../src/main/account/database/search-repository.ts"
import { limitSearchSection, sortedSearchSection } from "../src/main/account/search-ranking.ts"
import type { LocalSearchContactResult } from "../src/shared/account-data.ts"

function contact(id: string, name: string): LocalSearchContactResult {
  return {
    kind: "contact",
    id,
    name,
    nickname: "",
    avatarType: "user",
    avatarId: id,
    email: "",
    phone: "",
    online: false,
    lastOnlineAt: null,
  }
}

test("综合搜索每类最多返回三条并按中文名称排序", () => {
  const result = sortedSearchSection(
    [contact("4", "张三"), contact("2", "李四"), contact("1", "阿明"), contact("3", "王五")],
    3,
    (item) => item.name,
  )
  assert.deepEqual(
    result.items.map((item) => item.name),
    ["阿明", "李四", "王五"],
  )
  assert.equal(result.hasMore, true)
})

test("分类搜索最多返回一百条", () => {
  const result = limitSearchSection(
    Array.from({ length: 101 }, (_, index) => contact(String(index), `用户${index}`)),
    100,
  )
  assert.equal(result.items.length, 100)
  assert.equal(result.hasMore, true)
})

test("聊天记录只查询本地数据库并按时间倒序", () => {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  database
    .prepare(
      `INSERT INTO conversations (
        id, type, name, member_count, avatar, avatar_type, avatar_id, created_at,
        last_message_at, last_message_summary, pinned, notification_muted,
        is_builtin_assistant, unread_count, current, payload_json
      ) VALUES ('group-1', 'group', '项目群', 3, '', 'group', 'group-1', '', NULL,
                '', 0, 0, 0, 0, 1, '{}')`,
    )
    .run()
  const insert = database.prepare(
    `INSERT INTO messages (
      conversation_id, id, seq, created_at, sender_id, sender_type, sender_name,
      body_type, content, client_message_id, delivery_status, payload_json
    ) VALUES ('group-1', ?, ?, ?, 'user-1', 'user', '张三', 'text', ?, '', '', '{}')`,
  )
  insert.run("older", 1, "2026-01-01T08:00:00.000Z", "项目计划初稿")
  insert.run("newer", 2, "2026-01-02T08:00:00.000Z", "项目计划终稿")
  insert.run("other", 3, "2026-01-03T08:00:00.000Z", "普通消息")

  const repository = new SearchRepository(database)
  const results = repository.searchMessages("计划", 100)
  assert.deepEqual(
    results.map((item) => item.id),
    ["newer", "older"],
  )
  database.close()
})
