import type { DatabaseSync } from "node:sqlite"

export function initializeAccountSchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      avatar TEXT NOT NULL,
      avatar_type TEXT NOT NULL DEFAULT 'group',
      avatar_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      last_message_at TEXT,
      last_message_summary TEXT NOT NULL,
      pinned INTEGER NOT NULL,
      notification_muted INTEGER NOT NULL DEFAULT 0,
      is_builtin_assistant INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL,
      current INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      conversation_id TEXT NOT NULL,
      id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT NOT NULL DEFAULT '',
      body_type TEXT NOT NULL,
      content TEXT NOT NULL,
      client_message_id TEXT NOT NULL DEFAULT '',
      delivery_status TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      PRIMARY KEY (conversation_id, id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_seq
      ON messages(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS contact_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      online INTEGER NOT NULL,
      last_online_at TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      joined INTEGER NOT NULL,
      member_count INTEGER NOT NULL,
      visibility TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      description TEXT NOT NULL,
      online INTEGER NOT NULL,
      creator_user_id TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS avatar_cache (
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      local_file TEXT NOT NULL,
      content_type TEXT NOT NULL,
      resource_key TEXT NOT NULL UNIQUE,
      downloaded_at INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS media_cache (
      cache_key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      target_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      status TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      modified_at_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_cache_lookup
      ON media_cache(target_id, category, file_id);
    CREATE INDEX IF NOT EXISTS media_cache_last_accessed
      ON media_cache(last_accessed_at);
  `)

  ensureColumn(database, "conversations", "avatar_type", "TEXT NOT NULL DEFAULT 'group'")
  ensureColumn(database, "conversations", "avatar_id", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, "conversations", "created_at", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, "conversations", "notification_muted", "INTEGER NOT NULL DEFAULT 0")
  ensureColumn(database, "conversations", "is_builtin_assistant", "INTEGER NOT NULL DEFAULT 0")
  ensureColumn(database, "conversations", "member_count", "INTEGER NOT NULL DEFAULT 0")
  ensureColumn(database, "messages", "sender_name", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, "messages", "client_message_id", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, "messages", "delivery_status", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(database, "contact_users", "last_online_at", "TEXT")
  ensureColumn(database, "contact_apps", "creator_user_id", "TEXT")
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id
      ON messages(conversation_id, client_message_id)
      WHERE client_message_id <> '';
  `)
  migrateConversationVisibility(database)
}

function ensureColumn(database: DatabaseSync, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<
    Record<string, unknown>
  >
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function migrateConversationVisibility(database: DatabaseSync) {
  const migrationKey = "conversation_visibility_v2"
  const migrated = database
    .prepare("SELECT 1 AS found FROM metadata WHERE key = ?")
    .get(migrationKey) as Record<string, unknown> | undefined
  if (migrated?.found === 1) return
  database.exec("BEGIN IMMEDIATE")
  try {
    database.exec("UPDATE conversations SET current = 1")
    database.prepare("INSERT INTO metadata(key, value) VALUES (?, '1')").run(migrationKey)
    database.exec("COMMIT")
  } catch (error) {
    database.exec("ROLLBACK")
    throw error
  }
}
