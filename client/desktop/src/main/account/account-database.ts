import { DatabaseSync } from "node:sqlite"
import type {
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
  DesktopConversation,
  DesktopMessage,
} from "../../shared/account-data"
import type { AvatarCacheRecord } from "./avatar-types"

export type StoredConversation = DesktopConversation & { avatar: string; payload: unknown }
export type StoredMessage = DesktopMessage & { payload: unknown }
export type StoredContactUser = DesktopContactUser & {
  avatar: string
  updatedAt: string
  payload: unknown
}
export type StoredContactGroup = DesktopContactGroup & { avatar: string; payload: unknown }
export type StoredContactApp = DesktopContactApp & { avatar: string; payload: unknown }

export class AccountDatabase {
  private readonly database: DatabaseSync
  private closed = false

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath)
    this.database.exec(`
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
        body_type TEXT NOT NULL,
        content TEXT NOT NULL,
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
    `)
    this.ensureColumn("conversations", "avatar_type", "TEXT NOT NULL DEFAULT 'group'")
    this.ensureColumn("conversations", "avatar_id", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("conversations", "created_at", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("conversations", "notification_muted", "INTEGER NOT NULL DEFAULT 0")
    this.ensureColumn("conversations", "is_builtin_assistant", "INTEGER NOT NULL DEFAULT 0")
    this.migrateConversationVisibility()
  }

  upsertCurrentConversations(conversations: StoredConversation[]) {
    const statement = this.database.prepare(`
      INSERT INTO conversations (
        id, type, name, avatar, avatar_type, avatar_id, created_at, last_message_at,
        last_message_summary, pinned, notification_muted, is_builtin_assistant,
        unread_count, current, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        avatar = excluded.avatar,
        avatar_type = excluded.avatar_type,
        avatar_id = excluded.avatar_id,
        created_at = excluded.created_at,
        last_message_at = excluded.last_message_at,
        last_message_summary = excluded.last_message_summary,
        pinned = excluded.pinned,
        notification_muted = excluded.notification_muted,
        is_builtin_assistant = excluded.is_builtin_assistant,
        unread_count = excluded.unread_count,
        current = 1,
        payload_json = excluded.payload_json
    `)
    this.transaction(() => {
      for (const conversation of conversations) {
        statement.run(
          conversation.id,
          conversation.type,
          conversation.name,
          conversation.avatar,
          conversation.avatarType,
          conversation.avatarId,
          conversation.createdAt,
          conversation.lastMessageAt,
          conversation.lastMessageSummary,
          Number(conversation.pinned),
          Number(conversation.notificationMuted),
          Number(conversation.isBuiltinAssistant),
          conversation.unreadCount,
          JSON.stringify(conversation.payload),
        )
      }
    })
  }

  upsertMessages(messages: StoredMessage[]) {
    const statement = this.database.prepare(`
      INSERT INTO messages (
        conversation_id, id, seq, created_at, sender_id, sender_type,
        body_type, content, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, id) DO UPDATE SET
        seq = excluded.seq,
        created_at = excluded.created_at,
        sender_id = excluded.sender_id,
        sender_type = excluded.sender_type,
        body_type = excluded.body_type,
        content = excluded.content,
        payload_json = excluded.payload_json
    `)
    this.transaction(() => {
      for (const message of messages) {
        statement.run(
          message.conversationId,
          message.id,
          message.seq,
          message.createdAt,
          message.senderId,
          message.senderType,
          message.bodyType,
          message.content,
          JSON.stringify(message.payload),
        )
      }
    })
  }

  hasCurrentConversation(conversationId: string) {
    const row = this.database
      .prepare("SELECT 1 AS found FROM conversations WHERE id = ? AND current = 1")
      .get(conversationId) as Record<string, unknown> | undefined
    return row?.found === 1
  }

  touchConversationActivity(conversationId: string, createdAt: string) {
    this.database
      .prepare(
        `UPDATE conversations
         SET last_message_at = CASE
           WHEN last_message_at IS NULL OR last_message_at < ? THEN ?
           ELSE last_message_at
         END
         WHERE id = ? AND current = 1`,
      )
      .run(createdAt, createdAt, conversationId)
  }

  setConversationPinned(conversationId: string, pinned: boolean) {
    return (
      this.database
        .prepare("UPDATE conversations SET pinned = ? WHERE id = ? AND current = 1")
        .run(Number(pinned), conversationId).changes > 0
    )
  }

  setConversationMuted(conversationId: string, muted: boolean) {
    return (
      this.database
        .prepare("UPDATE conversations SET notification_muted = ? WHERE id = ? AND current = 1")
        .run(Number(muted), conversationId).changes > 0
    )
  }

  removeCurrentConversation(conversationId: string) {
    this.database.prepare("UPDATE conversations SET current = 0 WHERE id = ?").run(conversationId)
  }

  listConversations(): DesktopConversation[] {
    const rows = this.database
      .prepare(
        `SELECT conversations.id, conversations.type, conversations.name,
                conversations.avatar_type, conversations.avatar_id,
                conversations.created_at, conversations.last_message_at,
                COALESCE((
                  SELECT messages.content
                  FROM messages
                  WHERE messages.conversation_id = conversations.id
                  ORDER BY messages.seq DESC
                  LIMIT 1
                ), '') AS last_message_summary,
                conversations.pinned, conversations.notification_muted,
                conversations.is_builtin_assistant, conversations.unread_count
         FROM conversations
         WHERE conversations.current = 1
         ORDER BY conversations.is_builtin_assistant DESC, conversations.pinned DESC,
                  COALESCE(conversations.last_message_at, conversations.created_at, '') DESC,
                  conversations.name ASC`,
      )
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      name: String(row.name),
      avatarType: String(row.avatar_type) as DesktopConversation["avatarType"],
      avatarId: String(row.avatar_id),
      createdAt: String(row.created_at),
      lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
      lastMessageSummary: String(row.last_message_summary),
      pinned: row.pinned === 1,
      notificationMuted: row.notification_muted === 1,
      isBuiltinAssistant: row.is_builtin_assistant === 1,
      unreadCount: Number(row.unread_count),
    }))
  }

  listMessages(conversationId: string, currentUserId: string): DesktopMessage[] {
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, seq, created_at, sender_id, sender_type, body_type, content
         FROM messages
         WHERE conversation_id = ?
         ORDER BY seq ASC`,
      )
      .all(conversationId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversation_id),
      seq: Number(row.seq),
      createdAt: String(row.created_at),
      senderId: String(row.sender_id),
      senderType: String(row.sender_type),
      isMine: row.sender_id === currentUserId && row.sender_type === "user",
      bodyType: String(row.body_type),
      content: String(row.content),
    }))
  }

  replaceContacts(input: {
    mode: "organization" | "friends"
    users: StoredContactUser[]
    groups: StoredContactGroup[]
    apps: StoredContactApp[]
  }) {
    const userStatement = this.database.prepare(`
      INSERT INTO contact_users (
        id, name, nickname, avatar, email, phone, online, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const groupStatement = this.database.prepare(`
      INSERT INTO contact_groups (
        id, name, avatar, joined, member_count, visibility, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const appStatement = this.database.prepare(`
      INSERT INTO contact_apps (
        id, name, avatar, description, online, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const metadataStatement = this.database.prepare(`
      INSERT INTO metadata(key, value) VALUES ('contact_directory_mode', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)

    this.transaction(() => {
      this.database.exec(
        "DELETE FROM contact_users; DELETE FROM contact_groups; DELETE FROM contact_apps;",
      )
      metadataStatement.run(input.mode)
      for (const user of input.users) {
        userStatement.run(
          user.id,
          user.name,
          user.nickname,
          user.avatar,
          user.email,
          user.phone,
          Number(user.online),
          user.updatedAt,
          JSON.stringify(user.payload),
        )
      }
      for (const group of input.groups) {
        groupStatement.run(
          group.id,
          group.name,
          group.avatar,
          Number(group.joined),
          group.memberCount,
          group.visibility,
          JSON.stringify(group.payload),
        )
      }
      for (const app of input.apps) {
        appStatement.run(
          app.id,
          app.name,
          app.avatar,
          app.description,
          Number(app.online),
          JSON.stringify(app.payload),
        )
      }
    })
  }

  setContactUserPresence(userId: string, online: boolean) {
    return (
      this.database
        .prepare("UPDATE contact_users SET online = ? WHERE id = ?")
        .run(Number(online), userId).changes > 0
    )
  }

  getContacts(): DesktopContactDirectory {
    const modeRow = this.database
      .prepare("SELECT value FROM metadata WHERE key = 'contact_directory_mode'")
      .get() as Record<string, unknown> | undefined
    const mode = modeRow?.value === "friends" ? "friends" : "organization"
    const users = this.database
      .prepare(
        "SELECT id, name, nickname, avatar, email, phone, online FROM contact_users ORDER BY name",
      )
      .all() as Array<Record<string, unknown>>
    const groups = this.database
      .prepare(
        "SELECT id, name, avatar, joined, member_count, visibility FROM contact_groups ORDER BY name",
      )
      .all() as Array<Record<string, unknown>>
    const apps = this.database
      .prepare("SELECT id, name, avatar, description, online FROM contact_apps ORDER BY name")
      .all() as Array<Record<string, unknown>>
    return {
      mode,
      users: users.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        nickname: String(row.nickname),
        avatarType: "user",
        avatarId: String(row.id),
        email: String(row.email),
        phone: String(row.phone),
        online: row.online === 1,
      })),
      groups: groups.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        avatarType: "group",
        avatarId: String(row.id),
        joined: row.joined === 1,
        memberCount: Number(row.member_count),
        visibility: String(row.visibility),
      })),
      apps: apps.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        avatarType: "app",
        avatarId: String(row.id),
        description: String(row.description),
        online: row.online === 1,
      })),
    }
  }

  getConversationPayload(conversationId: string): unknown {
    return parsePayload(
      this.database
        .prepare("SELECT payload_json FROM conversations WHERE id = ?")
        .get(conversationId) as Record<string, unknown> | undefined,
    )
  }

  getContactPayload(type: "user" | "group" | "app", entityId: string): unknown {
    const table =
      type === "user" ? "contact_users" : type === "group" ? "contact_groups" : "contact_apps"
    return parsePayload(
      this.database.prepare(`SELECT payload_json FROM ${table} WHERE id = ?`).get(entityId) as
        | Record<string, unknown>
        | undefined,
    )
  }

  getAvatarCache(type: string, entityId: string): AvatarCacheRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT type, entity_id, source_url, local_file, content_type,
                resource_key, downloaded_at, checked_at
         FROM avatar_cache WHERE type = ? AND entity_id = ?`,
      )
      .get(type, entityId) as Record<string, unknown> | undefined
    return row ? avatarCacheRecord(row) : undefined
  }

  getAvatarCacheByResourceKey(resourceKey: string): AvatarCacheRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT type, entity_id, source_url, local_file, content_type,
                resource_key, downloaded_at, checked_at
         FROM avatar_cache WHERE resource_key = ?`,
      )
      .get(resourceKey) as Record<string, unknown> | undefined
    return row ? avatarCacheRecord(row) : undefined
  }

  upsertAvatarCache(record: AvatarCacheRecord) {
    this.database
      .prepare(
        `INSERT INTO avatar_cache (
           type, entity_id, source_url, local_file, content_type,
           resource_key, downloaded_at, checked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(type, entity_id) DO UPDATE SET
           source_url = excluded.source_url,
           local_file = excluded.local_file,
           content_type = excluded.content_type,
           resource_key = excluded.resource_key,
           downloaded_at = excluded.downloaded_at,
           checked_at = excluded.checked_at`,
      )
      .run(
        record.type,
        record.entityId,
        record.sourceUrl,
        record.localFile,
        record.contentType,
        record.resourceKey,
        record.downloadedAt,
        record.checkedAt,
      )
  }

  touchAvatarCache(type: string, entityId: string, checkedAt: number) {
    this.database
      .prepare("UPDATE avatar_cache SET checked_at = ? WHERE type = ? AND entity_id = ?")
      .run(checkedAt, type, entityId)
  }

  deleteAvatarCache(type: string, entityId: string): AvatarCacheRecord | undefined {
    const record = this.getAvatarCache(type, entityId)
    if (record) {
      this.database
        .prepare("DELETE FROM avatar_cache WHERE type = ? AND entity_id = ?")
        .run(type, entityId)
    }
    return record
  }

  deleteAvatarCaches(types: string[], entityId: string): AvatarCacheRecord[] {
    return types.flatMap((type) => {
      const record = this.deleteAvatarCache(type, entityId)
      return record ? [record] : []
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private migrateConversationVisibility() {
    const migrationKey = "conversation_visibility_v2"
    const migrated = this.database
      .prepare("SELECT 1 AS found FROM metadata WHERE key = ?")
      .get(migrationKey) as Record<string, unknown> | undefined
    if (migrated?.found === 1) return
    this.transaction(() => {
      this.database.exec("UPDATE conversations SET current = 1")
      this.database.prepare("INSERT INTO metadata(key, value) VALUES (?, '1')").run(migrationKey)
    })
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<
      Record<string, unknown>
    >
    if (!columns.some((entry) => entry.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  private transaction(operation: () => void) {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      operation()
      this.database.exec("COMMIT")
    } catch (error) {
      this.database.exec("ROLLBACK")
      throw error
    }
  }
}

function parsePayload(row: Record<string, unknown> | undefined): unknown {
  if (typeof row?.payload_json !== "string") return undefined
  try {
    return JSON.parse(row.payload_json)
  } catch {
    return undefined
  }
}

function avatarCacheRecord(row: Record<string, unknown>): AvatarCacheRecord {
  return {
    type: String(row.type) as AvatarCacheRecord["type"],
    entityId: String(row.entity_id),
    sourceUrl: String(row.source_url),
    localFile: String(row.local_file),
    contentType: String(row.content_type),
    resourceKey: String(row.resource_key),
    downloadedAt: Number(row.downloaded_at),
    checkedAt: Number(row.checked_at),
  }
}
