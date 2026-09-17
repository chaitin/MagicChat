import { DatabaseSync } from "node:sqlite"
import type {
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
  DesktopConversation,
  DesktopMessage,
  DesktopMessageBody,
} from "../../shared/account-data"
import type { MediaCacheStatus, MediaCategory } from "../../shared/media"
import type { AvatarCacheRecord } from "./avatar-types"
import { normalizeDesktopMessageDetails } from "./message-normalizer"

export type StoredConversation = DesktopConversation & { avatar: string; payload: unknown }
export type StoredMessage = DesktopMessage & { payload: unknown }
export type StoredContactUser = DesktopContactUser & {
  avatar: string
  updatedAt: string
  payload: unknown
}
export type StoredContactGroup = DesktopContactGroup & { avatar: string; payload: unknown }
export type StoredContactApp = DesktopContactApp & { avatar: string; payload: unknown }
export type StoredMediaCache = {
  cacheKey: string
  category: MediaCategory
  targetId: string
  fileId: string
  status: MediaCacheStatus
  relativePath: string
  originalName: string
  contentType: string
  extension: string
  sizeBytes: number
  sha256: string
  modifiedAtMs: number
  createdAt: number
  lastAccessedAt: number
}

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
    this.ensureColumn("conversations", "avatar_type", "TEXT NOT NULL DEFAULT 'group'")
    this.ensureColumn("conversations", "avatar_id", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("conversations", "created_at", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("conversations", "notification_muted", "INTEGER NOT NULL DEFAULT 0")
    this.ensureColumn("conversations", "is_builtin_assistant", "INTEGER NOT NULL DEFAULT 0")
    this.ensureColumn("messages", "sender_name", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("conversations", "member_count", "INTEGER NOT NULL DEFAULT 0")
    this.ensureColumn("messages", "client_message_id", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("messages", "delivery_status", "TEXT NOT NULL DEFAULT ''")
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id
        ON messages(conversation_id, client_message_id)
        WHERE client_message_id <> '';
    `)
    this.migrateConversationVisibility()
  }

  upsertCurrentConversations(conversations: StoredConversation[]) {
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

  getMediaCache(cacheKey: string): StoredMediaCache | undefined {
    const row = this.database
      .prepare(
        `SELECT cache_key, category, target_id, file_id, status, relative_path,
                original_name, content_type, extension, size_bytes, sha256,
                modified_at_ms, created_at, last_accessed_at
         FROM media_cache WHERE cache_key = ?`,
      )
      .get(cacheKey) as Record<string, unknown> | undefined
    return row ? mediaCacheRecord(row) : undefined
  }

  listIncompleteMediaCaches(): StoredMediaCache[] {
    return (
      this.database
        .prepare(
          `SELECT cache_key, category, target_id, file_id, status, relative_path,
                  original_name, content_type, extension, size_bytes, sha256,
                  modified_at_ms, created_at, last_accessed_at
           FROM media_cache WHERE status <> 'ready'`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(mediaCacheRecord)
  }

  upsertMediaCache(record: StoredMediaCache) {
    this.database
      .prepare(
        `INSERT INTO media_cache (
           cache_key, category, target_id, file_id, status, relative_path,
           original_name, content_type, extension, size_bytes, sha256,
           modified_at_ms, created_at, last_accessed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           category = excluded.category,
           target_id = excluded.target_id,
           file_id = excluded.file_id,
           status = excluded.status,
           relative_path = excluded.relative_path,
           original_name = excluded.original_name,
           content_type = excluded.content_type,
           extension = excluded.extension,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           modified_at_ms = excluded.modified_at_ms,
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(
        record.cacheKey,
        record.category,
        record.targetId,
        record.fileId,
        record.status,
        record.relativePath,
        record.originalName,
        record.contentType,
        record.extension,
        record.sizeBytes,
        record.sha256,
        record.modifiedAtMs,
        record.createdAt,
        record.lastAccessedAt,
      )
  }

  touchMediaCache(cacheKey: string, lastAccessedAt: number) {
    this.database
      .prepare("UPDATE media_cache SET last_accessed_at = ? WHERE cache_key = ?")
      .run(lastAccessedAt, cacheKey)
  }

  deleteMediaCache(cacheKey: string) {
    this.database.prepare("DELETE FROM media_cache WHERE cache_key = ?").run(cacheKey)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
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

function mediaCacheRecord(row: Record<string, unknown>): StoredMediaCache {
  return {
    cacheKey: String(row.cache_key),
    category: String(row.category) as MediaCategory,
    targetId: String(row.target_id),
    fileId: String(row.file_id),
    status: String(row.status) as MediaCacheStatus,
    relativePath: String(row.relative_path),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    extension: String(row.extension),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    modifiedAtMs: Number(row.modified_at_ms),
    createdAt: Number(row.created_at),
    lastAccessedAt: Number(row.last_accessed_at),
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
