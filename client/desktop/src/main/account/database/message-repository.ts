import type { DatabaseSync } from "node:sqlite"
import type { DesktopMessage } from "../../../shared/account-data"
import { normalizeDesktopMessageDetails } from "../message-normalizer"
import { OutgoingMessageRepository } from "./outgoing-message-repository"

export type StoredMessage = DesktopMessage & { payload: unknown }

export class MessageRepository {
  private readonly outgoing: OutgoingMessageRepository

  constructor(private readonly database: DatabaseSync) {
    this.outgoing = new OutgoingMessageRepository(database, (messages) =>
      this.upsertMessages(messages),
    )
  }

  upsertMessages(messages: StoredMessage[]) {
    const statement = this.database.prepare(`
      INSERT INTO messages (
        conversation_id, id, seq, created_at, sender_id, sender_type, sender_name,
        body_type, content, client_message_id, delivery_status, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, id) DO UPDATE SET
        seq = excluded.seq,
        created_at = excluded.created_at,
        sender_id = excluded.sender_id,
        sender_type = excluded.sender_type,
        sender_name = excluded.sender_name,
        body_type = excluded.body_type,
        content = excluded.content,
        client_message_id = excluded.client_message_id,
        delivery_status = excluded.delivery_status,
        payload_json = excluded.payload_json
    `)
    this.transaction(() => {
      for (const message of messages) {
        if (message.clientMessageId && !message.deliveryStatus) {
          this.database
            .prepare(
              `DELETE FROM messages
               WHERE conversation_id = ? AND client_message_id = ? AND id <> ?`,
            )
            .run(message.conversationId, message.clientMessageId, message.id)
        }
        statement.run(
          message.conversationId,
          message.id,
          message.seq,
          message.createdAt,
          message.senderId,
          message.senderType,
          message.senderName,
          message.bodyType,
          message.content,
          message.clientMessageId,
          message.deliveryStatus ?? "",
          JSON.stringify(message.payload),
        )
      }
    })
  }

  createOptimisticMessage(
    ...args: Parameters<OutgoingMessageRepository["createOptimisticMessage"]>
  ) {
    return this.outgoing.createOptimisticMessage(...args)
  }

  createOptimisticFileMessage(
    ...args: Parameters<OutgoingMessageRepository["createOptimisticFileMessage"]>
  ) {
    return this.outgoing.createOptimisticFileMessage(...args)
  }

  createOptimisticImageMessage(
    ...args: Parameters<OutgoingMessageRepository["createOptimisticImageMessage"]>
  ) {
    return this.outgoing.createOptimisticImageMessage(...args)
  }

  createOptimisticVideoMessage(
    ...args: Parameters<OutgoingMessageRepository["createOptimisticVideoMessage"]>
  ) {
    return this.outgoing.createOptimisticVideoMessage(...args)
  }

  setOutgoingMessageStatus(
    ...args: Parameters<OutgoingMessageRepository["setOutgoingMessageStatus"]>
  ) {
    return this.outgoing.setOutgoingMessageStatus(...args)
  }

  getOutgoingMessage(...args: Parameters<OutgoingMessageRepository["getOutgoingMessage"]>) {
    return this.outgoing.getOutgoingMessage(...args)
  }

  getOutgoingMedia(...args: Parameters<OutgoingMessageRepository["getOutgoingMedia"]>) {
    return this.outgoing.getOutgoingMedia(...args)
  }

  failPendingMessages() {
    this.outgoing.failPendingMessages()
  }

  updateMessageReactions(
    conversationId: string,
    messageId: string,
    reactionVersion: number,
    reactions: unknown[],
  ) {
    const row = this.database
      .prepare("SELECT payload_json FROM messages WHERE conversation_id = ? AND id = ?")
      .get(conversationId, messageId) as Record<string, unknown> | undefined
    const payload = parsePayload(row)
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
    const updated = {
      ...(payload as Record<string, unknown>),
      reaction_version: reactionVersion,
      reactions,
    }
    return (
      this.database
        .prepare("UPDATE messages SET payload_json = ? WHERE conversation_id = ? AND id = ?")
        .run(JSON.stringify(updated), conversationId, messageId).changes === 1
    )
  }

  listMessages(conversationId: string, currentUserId: string): DesktopMessage[] {
    const rows = this.database
      .prepare(
        `SELECT messages.id, messages.conversation_id, messages.seq, messages.created_at,
                messages.sender_id, messages.sender_type,
                COALESCE(
                  NULLIF(messages.sender_name, ''),
                  NULLIF(contact_users.nickname, ''),
                  contact_users.name,
                  contact_apps.name,
                  ''
                ) AS sender_name,
                messages.body_type, messages.content, messages.client_message_id,
                messages.delivery_status, messages.payload_json
         FROM messages
         LEFT JOIN contact_users
           ON messages.sender_type = 'user' AND contact_users.id = messages.sender_id
         LEFT JOIN contact_apps
           ON messages.sender_type = 'app' AND contact_apps.id = messages.sender_id
         WHERE messages.conversation_id = ?
         ORDER BY messages.seq ASC, messages.created_at ASC, messages.id ASC`,
      )
      .all(conversationId) as Array<Record<string, unknown>>
    return rows.map((row) => {
      const details = normalizeDesktopMessageDetails(parsePayload(row))
      return {
        id: String(row.id),
        conversationId: String(row.conversation_id),
        seq: Number(row.seq),
        createdAt: String(row.created_at),
        senderId: String(row.sender_id),
        senderType: String(row.sender_type),
        senderName: String(row.sender_name) || messageSenderNameFromPayload(row.payload_json),
        isMine: row.sender_id === currentUserId && row.sender_type === "user",
        bodyType: details.body.type,
        content: String(row.content),
        clientMessageId: String(row.client_message_id),
        deliveryStatus:
          row.delivery_status === "sending" || row.delivery_status === "failed"
            ? row.delivery_status
            : undefined,
        ...details,
      }
    })
  }

  updateMessageChoice(conversationId: string, messageId: string, choice: unknown) {
    const row = this.database
      .prepare("SELECT payload_json FROM messages WHERE conversation_id = ? AND id = ? LIMIT 1")
      .get(conversationId, messageId) as Record<string, unknown> | undefined
    const payload = parsePayload(row)
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
    const result = this.database
      .prepare("UPDATE messages SET payload_json = ? WHERE conversation_id = ? AND id = ?")
      .run(JSON.stringify({ ...payload, choice }), conversationId, messageId)
    return result.changes > 0
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

function messageSenderNameFromPayload(value: unknown) {
  if (typeof value !== "string") return ""
  try {
    const payload: unknown = JSON.parse(value)
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return ""
    const sender = (payload as Record<string, unknown>).sender
    if (!sender || typeof sender !== "object" || Array.isArray(sender)) return ""
    const record = sender as Record<string, unknown>
    if (typeof record.nickname === "string" && record.nickname) return record.nickname
    return typeof record.name === "string" ? record.name : ""
  } catch {
    return ""
  }
}
