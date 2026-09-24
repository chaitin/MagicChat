import type { DatabaseSync } from "node:sqlite"
import type { DesktopConversation } from "../../../shared/account-data"
import { parseConversationTopic } from "../conversation-topic.ts"
import { parseConversationMembers } from "../conversation-members.ts"

export type StoredConversation = DesktopConversation & { avatar: string; payload: unknown }

export class ConversationRepository {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  upsertCurrent(conversations: StoredConversation[]) {
    this.transaction(() => this.upsertRows(conversations))
  }

  private upsertRows(conversations: StoredConversation[]) {
    const statement = this.database.prepare(`
      INSERT INTO conversations (
        id, type, name, member_count, avatar, avatar_type, avatar_id, created_at, last_message_at,
        last_message_summary, pinned, notification_muted, is_builtin_assistant,
        unread_count, last_message_seq, last_read_seq, current, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
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
        last_message_seq = MAX(conversations.last_message_seq, excluded.last_message_seq),
        last_read_seq = MAX(conversations.last_read_seq, excluded.last_read_seq),
        unread_count = CASE WHEN MAX(conversations.last_message_seq, excluded.last_message_seq) = 0
          THEN excluded.unread_count
          ELSE MAX(0, MAX(conversations.last_message_seq, excluded.last_message_seq) - MAX(conversations.last_read_seq, excluded.last_read_seq)) END,
        current = 1,
        payload_json = excluded.payload_json
    `)
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
        conversation.lastMessageSeq ?? 0,
        conversation.lastReadSeq ?? 0,
        JSON.stringify(conversation.payload),
      )
    }
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

  applyMessageSeq(conversationId: string, seq: number, isMine: boolean) {
    if (!Number.isSafeInteger(seq) || seq <= 0) return
    this.database.prepare(`UPDATE conversations SET
      last_message_seq = MAX(last_message_seq, ?),
      last_read_seq = CASE WHEN ? THEN MAX(last_read_seq, ?) ELSE last_read_seq END,
      unread_count = MAX(0, MAX(last_message_seq, ?) - CASE WHEN ? THEN MAX(last_read_seq, ?) ELSE last_read_seq END)
      WHERE id = ? AND current = 1`).run(seq, Number(isMine), seq, seq, Number(isMine), seq, conversationId)
  }

  applyReadSeq(conversationId: string, seq: number) {
    if (!Number.isSafeInteger(seq) || seq < 0) return false
    return this.database.prepare(`UPDATE conversations SET
      last_read_seq = MAX(last_read_seq, ?),
      unread_count = MAX(0, last_message_seq - MAX(last_read_seq, ?))
      WHERE id = ? AND current = 1`).run(seq, seq, conversationId).changes > 0
  }

  getReadSeq(conversationId: string) {
    const row = this.database.prepare("SELECT last_read_seq FROM conversations WHERE id = ? AND current = 1")
      .get(conversationId) as { last_read_seq: number } | undefined
    return row?.last_read_seq
  }

  isMuted(conversationId: string) {
    const row = this.database
      .prepare("SELECT notification_muted FROM conversations WHERE id = ? AND current = 1")
      .get(conversationId) as { notification_muted: number } | undefined
    return row?.notification_muted === 1
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

  list(now = new Date(), selectedConversationId: string | null = null): DesktopConversation[] {
    const topicActivityCutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
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
                conversations.is_builtin_assistant, conversations.unread_count,
                conversations.last_message_seq, conversations.last_read_seq,
                conversations.payload_json
         FROM conversations
         WHERE conversations.current = 1
           AND (
             conversations.type <> 'topic'
             OR conversations.unread_count > 0
             OR COALESCE(conversations.last_message_at, conversations.created_at) >= ?
             OR conversations.id = ?
           )
         ORDER BY conversations.is_builtin_assistant DESC, conversations.pinned DESC,
                  COALESCE(conversations.last_message_at, conversations.created_at, '') DESC,
                  conversations.name ASC`,
      )
      .all(topicActivityCutoff, selectedConversationId) as Array<Record<string, unknown>>
    return rows.map((row) => this.mapRow(row))
  }

  listTopics(parentId: string, offset: number, keyword = "") {
    const rows = this.database
      .prepare(
        `SELECT c.id, c.type, c.name, c.member_count, c.avatar_type, c.avatar_id,
                c.created_at, c.last_message_at,
                COALESCE((SELECT content FROM messages WHERE conversation_id = c.id
                  ORDER BY seq DESC, created_at DESC, id DESC LIMIT 1), '') AS last_message_summary,
                c.pinned, c.notification_muted, c.is_builtin_assistant, c.unread_count,
                c.last_message_seq, c.last_read_seq, c.payload_json
         FROM conversations c
         WHERE c.type = 'topic' AND c.current = 1
           AND json_valid(c.payload_json)
           AND json_extract(c.payload_json, '$.topic.parent_conversation_id') = ?
           AND (? = '' OR instr(lower(c.name), lower(?)) > 0)
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
         LIMIT 51 OFFSET ?`,
      )
      .all(parentId, keyword, keyword, offset) as Array<Record<string, unknown>>
    return {
      items: rows.slice(0, 50).map((row) => this.mapRow(row)),
      nextOffset: rows.length > 50 ? offset + 50 : null,
    }
  }

  private mapRow(row: Record<string, unknown>): DesktopConversation {
    const payload = parsePayload({ payload_json: row.payload_json })
    return {
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
      lastMessageSeq: Number(row.last_message_seq),
      lastReadSeq: Number(row.last_read_seq),
      topic: parseConversationTopic(payload),
      members: parseConversationMembers(payload),
    }
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
