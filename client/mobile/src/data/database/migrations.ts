import { DATABASE_VERSION } from "@/data/database/database-version"
import { DATABASE_SCHEMA_SQL } from "@/data/database/schema"

export function requiresNormalizedMessageReset(previousVersion: number) {
  return previousVersion < 4
}

export function createDatabaseMigrationSQL(previousVersion: number) {
  const resetNormalizedMessages = requiresNormalizedMessageReset(previousVersion)
    ? `DELETE FROM cached_messages;
       DELETE FROM message_sync_state;
       DELETE FROM message_cache_stats;`
    : ""

  return `
    ${DATABASE_SCHEMA_SQL}

    ${resetNormalizedMessages}

    DELETE FROM message_cache_stats;

    INSERT INTO message_cache_stats (
      server_key, user_id, conversation_id, message_count, payload_bytes
    )
    SELECT server_key, user_id, conversation_id, COUNT(*),
           COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
      FROM cached_messages
     GROUP BY server_key, user_id, conversation_id;

    PRAGMA user_version = ${DATABASE_VERSION};
  `
}
