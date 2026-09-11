import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { DATABASE_VERSION } from "@/data/database/database-version"
import {
  createDatabaseMigrationSQL,
  requiresNormalizedMessageReset,
} from "@/data/database/migrations"

test("v4 to v5 migration adds conversations without deleting message data", () => {
  const sql = createDatabaseMigrationSQL(4)
  assert.equal(DATABASE_VERSION, 6)
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+cached_messages/i)
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+message_sync_state/i)

  const database = new DatabaseSync(":memory:")
  try {
    database.exec(createDatabaseMigrationSQL(0))
    database.exec(`
      INSERT INTO cached_messages (
        server_key, user_id, conversation_id, message_id, seq,
        reaction_version, payload_json, created_at, cached_at
      ) VALUES ('server', 'user', 'conversation', 'message', 1, 0, '{}', 'now', 1);
      INSERT INTO message_sync_state (
        server_key, user_id, conversation_id, last_accessed_at
      ) VALUES ('server', 'user', 'conversation', 1);
    `)
    database.exec(sql)

    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM cached_messages").get()
        ?.count,
      1
    )
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM message_sync_state").get()
        ?.count,
      1
    )
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='cached_conversations'"
        )
        .get()?.count,
      1
    )
  } finally {
    database.close()
  }
})

test("new database and v3, v4, v5 upgrades remain compatible", () => {
  assert.equal(DATABASE_VERSION, 6)
  for (const previousVersion of [0, 3, 4, 5]) {
    const database = new DatabaseSync(":memory:")
    try {
      database.exec(createDatabaseMigrationSQL(0))
      if (previousVersion > 0) {
        database.exec(`
          INSERT INTO cached_messages (
            server_key, user_id, conversation_id, message_id, seq,
            reaction_version, payload_json, created_at, cached_at
          ) VALUES ('s', 'u', 'c', 'm', 1, 0, '{"body":"hello"}', 'now', 1);
          INSERT INTO message_sync_state (server_key, user_id, conversation_id, last_accessed_at)
          VALUES ('s', 'u', 'c', 1);
          UPDATE message_cache_stats SET message_count = 99, payload_bytes = 99;
          PRAGMA user_version = ${previousVersion};
        `)
        database.exec(createDatabaseMigrationSQL(previousVersion))
      }
      const preserved = previousVersion >= 4 ? 1 : 0
      assert.equal(database.prepare("SELECT COUNT(*) count FROM cached_messages").get()?.count, preserved)
      assert.equal(database.prepare("SELECT COUNT(*) count FROM message_sync_state").get()?.count, preserved)
      assert.equal(database.prepare("SELECT COALESCE(SUM(message_count), 0) count FROM message_cache_stats").get()?.count, preserved)
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 6)
      assert.equal(requiresNormalizedMessageReset(previousVersion), previousVersion < 4)
    } finally {
      database.close()
    }
  }
})

test("failed migration transaction rolls back schema and version", () => {
  const database = new DatabaseSync(":memory:")
  try {
    database.exec(createDatabaseMigrationSQL(0))
    database.exec("DROP TABLE cached_project_pages; PRAGMA user_version = 5;")
    assert.throws(() => {
      database.exec("BEGIN")
      try {
        database.exec(createDatabaseMigrationSQL(5))
        database.exec("INSERT INTO missing_table VALUES (1)")
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    })
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 5)
    assert.equal(database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='cached_project_pages'").get()?.count, 0)
  } finally {
    database.close()
  }
})
