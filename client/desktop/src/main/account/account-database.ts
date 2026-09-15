import { DatabaseSync } from "node:sqlite"
import type {
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
  DesktopConversation,
  DesktopMessage,
} from "../../shared/account-data"

export type StoredConversation = DesktopConversation & { payload: unknown }
export type StoredMessage = DesktopMessage & { payload: unknown }
export type StoredContactUser = DesktopContactUser & { updatedAt: string; payload: unknown }
export type StoredContactGroup = DesktopContactGroup & { payload: unknown }
export type StoredContactApp = DesktopContactApp & { payload: unknown }

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
        last_message_at TEXT,
        last_message_summary TEXT NOT NULL,
        pinned INTEGER NOT NULL,
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
    `)
  }

  replaceCurrentConversations(conversations: StoredConversation[]) {
    const statement = this.database.prepare(`
      INSERT INTO conversations (
        id, type, name, avatar, last_message_at, last_message_summary,
        pinned, unread_count, current, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        avatar = excluded.avatar,
        last_message_at = excluded.last_message_at,
        last_message_summary = excluded.last_message_summary,
        pinned = excluded.pinned,
        unread_count = excluded.unread_count,
        current = 1,
        payload_json = excluded.payload_json
    `)
    this.transaction(() => {
      this.database.exec("UPDATE conversations SET current = 0")
      for (const conversation of conversations) {
        statement.run(
          conversation.id,
          conversation.type,
          conversation.name,
          conversation.avatar,
          conversation.lastMessageAt,
          conversation.lastMessageSummary,
          Number(conversation.pinned),
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

  listConversations(): DesktopConversation[] {
    const rows = this.database
      .prepare(
        `SELECT id, type, name, avatar, last_message_at, last_message_summary,
                pinned, unread_count
         FROM conversations
         WHERE current = 1
         ORDER BY pinned DESC, COALESCE(last_message_at, '') DESC, name ASC`,
      )
      .all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      name: String(row.name),
      avatar: String(row.avatar),
      lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
      lastMessageSummary: String(row.last_message_summary),
      pinned: row.pinned === 1,
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
        avatar: String(row.avatar),
        email: String(row.email),
        phone: String(row.phone),
        online: row.online === 1,
      })),
      groups: groups.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        avatar: String(row.avatar),
        joined: row.joined === 1,
        memberCount: Number(row.member_count),
        visibility: String(row.visibility),
      })),
      apps: apps.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        avatar: String(row.avatar),
        description: String(row.description),
        online: row.online === 1,
      })),
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
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
