export const DATABASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cached_messages (
    server_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    reaction_version INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (server_key, user_id, conversation_id, message_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS cached_messages_by_seq
  ON cached_messages (server_key, user_id, conversation_id, seq);

  CREATE INDEX IF NOT EXISTS cached_messages_recent
  ON cached_messages (server_key, user_id, conversation_id, seq DESC);

  CREATE TABLE IF NOT EXISTS message_sync_state (
    server_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    http_synced_through_seq INTEGER NOT NULL DEFAULT 0,
    oldest_cached_seq INTEGER,
    has_more_before INTEGER NOT NULL DEFAULT 1,
    last_synced_at INTEGER,
    last_accessed_at INTEGER NOT NULL,
    PRIMARY KEY (server_key, user_id, conversation_id)
  );

  CREATE INDEX IF NOT EXISTS message_sync_state_lru
  ON message_sync_state (last_accessed_at ASC);

  CREATE TABLE IF NOT EXISTS message_cache_stats (
    server_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    payload_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_key, user_id, conversation_id)
  );

  CREATE TABLE IF NOT EXISTS cached_conversations (
    server_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    parent_conversation_id TEXT,
    conversation_type TEXT NOT NULL,
    last_activity_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    tombstone_at INTEGER,
    observed_at INTEGER NOT NULL,
    cached_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (server_key, user_id, conversation_id)
  );

  CREATE INDEX IF NOT EXISTS cached_conversations_list
  ON cached_conversations (server_key, user_id, tombstone_at, pinned DESC, last_activity_at DESC);

  CREATE INDEX IF NOT EXISTS cached_conversations_parent
  ON cached_conversations (server_key, user_id, parent_conversation_id);

  CREATE TABLE IF NOT EXISTS cached_contact_directories (
    server_key TEXT NOT NULL, user_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    observed_at INTEGER NOT NULL, cached_at INTEGER NOT NULL,
    PRIMARY KEY (server_key, user_id)
  );

  CREATE TABLE IF NOT EXISTS cached_user_profiles (
    server_key TEXT NOT NULL, user_id TEXT NOT NULL, profile_user_id TEXT NOT NULL,
    payload_json TEXT, version TEXT, cached_at INTEGER NOT NULL,
    missing_until INTEGER,
    PRIMARY KEY (server_key, user_id, profile_user_id)
  );
  CREATE INDEX IF NOT EXISTS cached_user_profiles_target
  ON cached_user_profiles (server_key, user_id, cached_at);

  CREATE TABLE IF NOT EXISTS cached_project_pages (
    server_key TEXT NOT NULL, user_id TEXT NOT NULL, request_cursor TEXT NOT NULL,
    payload_json TEXT NOT NULL, next_cursor TEXT, cached_at INTEGER NOT NULL,
    PRIMARY KEY (server_key, user_id, request_cursor)
  );
  CREATE INDEX IF NOT EXISTS cached_project_pages_target
  ON cached_project_pages (server_key, user_id, cached_at);
`
