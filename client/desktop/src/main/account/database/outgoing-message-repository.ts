import type { DatabaseSync } from "node:sqlite"
import type { DesktopMessageBody } from "../../../shared/account-data"
import type { StoredMessage } from "./message-repository"

export class OutgoingMessageRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly upsertMessages: (messages: StoredMessage[]) => void,
  ) {}

  createOptimisticMessage(input: {
    conversationId: string
    clientMessageId: string
    content: string
    bodyType: "text" | "markdown"
    senderId: string
    senderName: string
  }) {
    const seqRow = this.database
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ?")
      .get(input.conversationId) as Record<string, unknown>
    const seq = Number(seqRow.seq) + 1
    const createdAt = new Date().toISOString()
    const id = `optimistic:${input.clientMessageId}`
    const payload = {
      id,
      client_message_id: input.clientMessageId,
      conversation_id: input.conversationId,
      created_at: createdAt,
      sender: { id: input.senderId, type: "user", name: input.senderName },
      seq,
      body: { type: input.bodyType, content: input.content },
      reactions: [],
    }
    this.upsertMessages([
      {
        id,
        conversationId: input.conversationId,
        seq,
        createdAt,
        senderId: input.senderId,
        senderType: "user",
        senderName: input.senderName,
        isMine: true,
        bodyType: input.bodyType,
        content: input.content,
        clientMessageId: input.clientMessageId,
        deliveryStatus: "sending",
        body: { type: input.bodyType, content: input.content },
        reactions: [],
        payload,
      },
    ])
    this.database
      .prepare(
        `UPDATE conversations
         SET last_message_at = ?, last_message_summary = ?
         WHERE id = ?`,
      )
      .run(createdAt, input.content, input.conversationId)
  }

  createOptimisticFileMessage(input: {
    conversationId: string
    clientMessageId: string
    filePath: string
    name: string
    sizeBytes: number
    senderId: string
    senderName: string
  }) {
    const seqRow = this.database
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ?")
      .get(input.conversationId) as Record<string, unknown>
    const seq = Number(seqRow.seq) + 1
    const createdAt = new Date().toISOString()
    const id = `optimistic:${input.clientMessageId}`
    const body = {
      type: "file" as const,
      fileId: input.clientMessageId,
      name: input.name,
      sizeBytes: input.sizeBytes,
    }
    const payload = {
      id,
      client_message_id: input.clientMessageId,
      conversation_id: input.conversationId,
      created_at: createdAt,
      sender: { id: input.senderId, type: "user", name: input.senderName },
      seq,
      body: {
        type: "file",
        file_id: input.clientMessageId,
        name: input.name,
        size_bytes: input.sizeBytes,
      },
      reactions: [],
      local_file_path: input.filePath,
    }
    this.upsertMessages([
      {
        id,
        conversationId: input.conversationId,
        seq,
        createdAt,
        senderId: input.senderId,
        senderType: "user",
        senderName: input.senderName,
        isMine: true,
        bodyType: "file",
        content: input.name,
        clientMessageId: input.clientMessageId,
        deliveryStatus: "sending",
        body,
        reactions: [],
        payload,
      },
    ])
    this.database
      .prepare(
        `UPDATE conversations
         SET last_message_at = ?, last_message_summary = ?
         WHERE id = ?`,
      )
      .run(createdAt, `[文件] ${input.name}`, input.conversationId)
  }

  createOptimisticImageMessage(input: {
    conversationId: string
    clientMessageId: string
    filePath: string
    name: string
    sizeBytes: number
    contentType: string
    width: number
    height: number
    caption: string
    senderId: string
    senderName: string
  }) {
    const body = {
      type: "image" as const,
      fileId: `outgoing:${input.clientMessageId}`,
      ...(input.caption ? { caption: input.caption, captionType: "text" as const } : {}),
      width: input.width,
      height: input.height,
    }
    this.createOptimisticMediaMessage({
      ...input,
      body,
      bodyType: "image",
      content: input.caption || "[图片]",
      summary: input.caption || "[图片]",
      payloadBody: {
        type: "image",
        file_id: `outgoing:${input.clientMessageId}`,
        ...(input.caption ? { caption: input.caption, caption_type: "text" } : {}),
        width: input.width,
        height: input.height,
      },
    })
  }

  createOptimisticVideoMessage(input: {
    conversationId: string
    clientMessageId: string
    filePath: string
    name: string
    sizeBytes: number
    contentType: string
    caption: string
    senderId: string
    senderName: string
  }) {
    const body = {
      type: "video" as const,
      fileId: `outgoing:${input.clientMessageId}`,
      name: input.name,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      ...(input.caption ? { caption: input.caption, captionType: "text" as const } : {}),
    }
    this.createOptimisticMediaMessage({
      ...input,
      body,
      bodyType: "video",
      content: input.caption || input.name,
      summary: input.caption || `[视频] ${input.name}`,
      payloadBody: {
        type: "video",
        file_id: `outgoing:${input.clientMessageId}`,
        name: input.name,
        size_bytes: input.sizeBytes,
        content_type: input.contentType,
        ...(input.caption ? { caption: input.caption, caption_type: "text" } : {}),
      },
    })
  }

  setOutgoingMessageStatus(
    conversationId: string,
    clientMessageId: string,
    status: "sending" | "failed",
  ) {
    return (
      this.database
        .prepare(
          `UPDATE messages SET delivery_status = ?
           WHERE conversation_id = ? AND client_message_id = ?`,
        )
        .run(status, conversationId, clientMessageId).changes === 1
    )
  }

  getOutgoingMessage(conversationId: string, clientMessageId: string) {
    const row = this.database
      .prepare(
        `SELECT content, body_type, delivery_status, payload_json
         FROM messages
         WHERE conversation_id = ? AND client_message_id = ?
           AND body_type IN ('text', 'markdown', 'file', 'image', 'video')`,
      )
      .get(conversationId, clientMessageId) as Record<string, unknown> | undefined
    if (!row) return undefined
    if (row.body_type === "file" || row.body_type === "image" || row.body_type === "video") {
      const parsedPayload = parsePayload(row)
      const payload =
        parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
          ? (parsedPayload as Record<string, unknown>)
          : undefined
      const filePath = typeof payload?.local_file_path === "string" ? payload.local_file_path : ""
      const body =
        payload?.body && typeof payload.body === "object" && !Array.isArray(payload.body)
          ? (payload.body as Record<string, unknown>)
          : undefined
      const sizeBytes = Number(body?.size_bytes ?? payload?.local_file_size)
      if (!filePath || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return undefined
      const bodyType =
        row.body_type === "image"
          ? ("image" as const)
          : row.body_type === "video"
            ? ("video" as const)
            : ("file" as const)
      return {
        bodyType,
        filePath,
        name:
          typeof body?.name === "string"
            ? body.name
            : typeof payload?.local_file_name === "string"
              ? payload.local_file_name
              : String(row.content),
        sizeBytes,
        contentType:
          typeof body?.content_type === "string"
            ? body.content_type
            : typeof payload?.local_content_type === "string"
              ? payload.local_content_type
              : "",
        caption: typeof body?.caption === "string" ? body.caption : "",
        status: String(row.delivery_status),
      }
    }
    return {
      content: String(row.content),
      bodyType: row.body_type === "markdown" ? ("markdown" as const) : ("text" as const),
      status: String(row.delivery_status),
    }
  }

  getOutgoingMedia(clientMessageId: string) {
    const row = this.database
      .prepare(
        `SELECT body_type, payload_json
         FROM messages
         WHERE client_message_id = ? AND body_type IN ('image', 'video')`,
      )
      .get(clientMessageId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const parsedPayload = parsePayload(row)
    const payload =
      parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)
        ? (parsedPayload as Record<string, unknown>)
        : undefined
    const body =
      payload?.body && typeof payload.body === "object" && !Array.isArray(payload.body)
        ? (payload.body as Record<string, unknown>)
        : undefined
    const filePath = typeof payload?.local_file_path === "string" ? payload.local_file_path : ""
    const sizeBytes = Number(body?.size_bytes ?? payload?.local_file_size)
    const contentType =
      typeof body?.content_type === "string"
        ? body.content_type
        : typeof payload?.local_content_type === "string"
          ? payload.local_content_type
          : ""
    if (!filePath || !contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return undefined
    }
    return {
      category: row.body_type === "image" ? ("image" as const) : ("video" as const),
      contentType,
      filePath,
      name:
        typeof body?.name === "string"
          ? body.name
          : typeof payload?.local_file_name === "string"
            ? payload.local_file_name
            : "image",
      sizeBytes,
    }
  }

  failPendingMessages() {
    this.database
      .prepare("UPDATE messages SET delivery_status = 'failed' WHERE delivery_status = 'sending'")
      .run()
  }

  private createOptimisticMediaMessage(input: {
    conversationId: string
    clientMessageId: string
    filePath: string
    name: string
    sizeBytes: number
    contentType: string
    senderId: string
    senderName: string
    bodyType: "image" | "video"
    body: DesktopMessageBody
    payloadBody: Record<string, unknown>
    content: string
    summary: string
  }) {
    const seqRow = this.database
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE conversation_id = ?")
      .get(input.conversationId) as Record<string, unknown>
    const seq = Number(seqRow.seq) + 1
    const createdAt = new Date().toISOString()
    const id = `optimistic:${input.clientMessageId}`
    const payload = {
      id,
      client_message_id: input.clientMessageId,
      conversation_id: input.conversationId,
      created_at: createdAt,
      sender: { id: input.senderId, type: "user", name: input.senderName },
      seq,
      body: input.payloadBody,
      reactions: [],
      local_file_path: input.filePath,
      local_file_name: input.name,
      local_file_size: input.sizeBytes,
      local_content_type: input.contentType,
    }
    this.upsertMessages([
      {
        id,
        conversationId: input.conversationId,
        seq,
        createdAt,
        senderId: input.senderId,
        senderType: "user",
        senderName: input.senderName,
        isMine: true,
        bodyType: input.bodyType,
        content: input.content,
        clientMessageId: input.clientMessageId,
        deliveryStatus: "sending",
        body: input.body,
        reactions: [],
        payload,
      },
    ])
    this.database
      .prepare(
        `UPDATE conversations
         SET last_message_at = ?, last_message_summary = ?
         WHERE id = ?`,
      )
      .run(createdAt, input.summary, input.conversationId)
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
