import type { DatabaseSync } from "node:sqlite"
import type { DesktopConversation } from "../../../shared/account-data"

export type StoredConversation = DesktopConversation & { avatar: string; payload: unknown }

export class ConversationRepository {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  upsertCurrent(conversations: StoredConversation[]) {
    const statement = this.database.prepare(`
      INSERT INTO conversations (
        id, type, name, member_count, avatar, avatar_type, avatar_id, created_at, last_message_at,
        last_message_summary, pinned, notification_muted, is_builtin_assistant,
        unread_count, current, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        member_count = excluded.member_count,
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
          conversation.memberCount,
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

  hasCurrent(conversationId: string) {
    const row = this.database
      .prepare("SELECT 1 AS found FROM conversations WHERE id = ? AND current = 1")
      .get(conversationId) as Record<string, unknown> | undefined
    return row?.found === 1
  }

  touchActivity(conversationId: string, createdAt: string) {
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

  setPinned(conversationId: string, pinned: boolean) {
    return (
      this.database
        .prepare("UPDATE conversations SET pinned = ? WHERE id = ? AND current = 1")
        .run(Number(pinned), conversationId).changes > 0
    )
  }

  setMuted(conversationId: string, muted: boolean) {
    return (
      this.database
        .prepare("UPDATE conversations SET notification_muted = ? WHERE id = ? AND current = 1")
        .run(Number(muted), conversationId).changes > 0
    )
  }

  removeCurrent(conversationId: string) {
    this.database.prepare("UPDATE conversations SET current = 0 WHERE id = ?").run(conversationId)
  }

  list(): DesktopConversation[] {
    const rows = this.database
      .prepare(
        `SELECT conversations.id, conversations.type, conversations.name,
                conversations.member_count, conversations.avatar_type, conversations.avatar_id,
                conversations.created_at, conversations.last_message_at,
                COALESCE((
                  SELECT messages.content
                  FROM messages
                  WHERE messages.conversation_id = conversations.id
                  ORDER BY messages.seq DESC, messages.created_at DESC, messages.id DESC
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
      memberCount: Number(row.member_count),
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

  getPayload(conversationId: string): unknown {
    return parsePayload(
      this.database
        .prepare("SELECT payload_json FROM conversations WHERE id = ?")
        .get(conversationId) as Record<string, unknown> | undefined,
    )
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
