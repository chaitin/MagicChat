import type { DatabaseSync } from "node:sqlite"
import type {
  AvatarType,
  LocalSearchAppResult,
  LocalSearchContactResult,
  LocalSearchGroupResult,
  LocalSearchMessageResult,
} from "../../../shared/account-data"

export class SearchRepository {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  searchContacts(query: string): LocalSearchContactResult[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, nickname, email, phone, online, last_online_at
         FROM contact_users
         WHERE instr(lower(name), ?) > 0
            OR instr(lower(nickname), ?) > 0
            OR instr(lower(email), ?) > 0
            OR instr(lower(phone), ?) > 0`,
      )
      .all(query, query, query, query) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      kind: "contact",
      id: String(row.id),
      name: String(row.name),
      nickname: String(row.nickname),
      avatarType: "user",
      avatarId: String(row.id),
      email: String(row.email),
      phone: String(row.phone),
      online: row.online === 1,
      lastOnlineAt: typeof row.last_online_at === "string" ? row.last_online_at : null,
    }))
  }

  searchApps(query: string): LocalSearchAppResult[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, description, online, creator_user_id
         FROM contact_apps
         WHERE instr(lower(name), ?) > 0
            OR instr(lower(description), ?) > 0`,
      )
      .all(query, query) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      kind: "app",
      id: String(row.id),
      name: String(row.name),
      avatarType: "app",
      avatarId: String(row.id),
      description: String(row.description),
      online: row.online === 1,
      creatorUserId: typeof row.creator_user_id === "string" ? row.creator_user_id : null,
    }))
  }

  searchGroups(query: string): LocalSearchGroupResult[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, joined, member_count, visibility
         FROM contact_groups
         WHERE instr(lower(name), ?) > 0`,
      )
      .all(query) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      kind: "group",
      id: String(row.id),
      name: String(row.name),
      avatarType: "group",
      avatarId: String(row.id),
      joined: row.joined === 1,
      memberCount: Number(row.member_count),
      visibility: String(row.visibility),
    }))
  }

  searchMessages(query: string, limit: number): LocalSearchMessageResult[] {
    const rows = this.database
      .prepare(
        `SELECT messages.id, messages.conversation_id, messages.created_at,
                COALESCE(
                  NULLIF(messages.sender_name, ''),
                  NULLIF(contact_users.nickname, ''),
                  contact_users.name,
                  contact_apps.name,
                  ''
                ) AS sender_name,
                messages.content,
                conversations.name AS conversation_name,
                conversations.avatar_type AS conversation_avatar_type,
                conversations.avatar_id AS conversation_avatar_id
         FROM messages
         JOIN conversations ON conversations.id = messages.conversation_id
         LEFT JOIN contact_users
           ON messages.sender_type = 'user' AND contact_users.id = messages.sender_id
         LEFT JOIN contact_apps
           ON messages.sender_type = 'app' AND contact_apps.id = messages.sender_id
         WHERE conversations.current = 1
           AND messages.content <> ''
           AND messages.body_type <> 'revoked'
           AND instr(lower(messages.content), ?) > 0
         ORDER BY messages.created_at DESC, messages.seq DESC, messages.id DESC
         LIMIT ?`,
      )
      .all(query, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      kind: "message",
      id: String(row.id),
      conversationId: String(row.conversation_id),
      conversationName: String(row.conversation_name),
      conversationAvatarType: String(row.conversation_avatar_type) as AvatarType,
      conversationAvatarId: String(row.conversation_avatar_id),
      senderName: String(row.sender_name),
      createdAt: String(row.created_at),
      summary: String(row.content),
    }))
  }
}
