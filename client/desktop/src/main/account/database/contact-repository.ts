import type { DatabaseSync } from "node:sqlite"
import type {
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
} from "../../../shared/account-data"

export type StoredContactUser = DesktopContactUser & {
  avatar: string
  updatedAt: string
  payload: unknown
}
export type StoredContactGroup = DesktopContactGroup & { avatar: string; payload: unknown }
export type StoredContactApp = DesktopContactApp & { avatar: string; payload: unknown }

export class ContactRepository {
  constructor(private readonly database: DatabaseSync) {}

  replace(input: {
    mode: "organization" | "friends"
    users: StoredContactUser[]
    groups: StoredContactGroup[]
    apps: StoredContactApp[]
  }) {
    const userStatement = this.database.prepare(`
      INSERT INTO contact_users (
        id, name, nickname, avatar, email, phone, online, last_online_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const groupStatement = this.database.prepare(`
      INSERT INTO contact_groups (
        id, name, avatar, joined, member_count, visibility, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const appStatement = this.database.prepare(`
      INSERT INTO contact_apps (
        id, name, avatar, description, online, creator_user_id, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
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
          user.lastOnlineAt ?? null,
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
          app.creatorUserId ?? null,
          JSON.stringify(app.payload),
        )
      }
    })
  }

  setUserPresence(userId: string, online: boolean) {
    return (
      this.database
        .prepare("UPDATE contact_users SET online = ? WHERE id = ?")
        .run(Number(online), userId).changes > 0
    )
  }

  getDirectory(): DesktopContactDirectory {
    const modeRow = this.database
      .prepare("SELECT value FROM metadata WHERE key = 'contact_directory_mode'")
      .get() as Record<string, unknown> | undefined
    const mode = modeRow?.value === "friends" ? "friends" : "organization"
    const users = this.database
      .prepare(
        "SELECT id, name, nickname, avatar, email, phone, online, last_online_at FROM contact_users ORDER BY name",
      )
      .all() as Array<Record<string, unknown>>
    const groups = this.database
      .prepare(
        "SELECT id, name, avatar, joined, member_count, visibility FROM contact_groups ORDER BY name",
      )
      .all() as Array<Record<string, unknown>>
    const apps = this.database
      .prepare(
        "SELECT id, name, avatar, description, online, creator_user_id FROM contact_apps ORDER BY name",
      )
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
        lastOnlineAt: typeof row.last_online_at === "string" ? row.last_online_at : null,
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
        creatorUserId: typeof row.creator_user_id === "string" ? row.creator_user_id : null,
      })),
    }
  }

  getPayload(type: "user" | "group" | "app", entityId: string): unknown {
    const table =
      type === "user" ? "contact_users" : type === "group" ? "contact_groups" : "contact_apps"
    return parsePayload(
      this.database.prepare(`SELECT payload_json FROM ${table} WHERE id = ?`).get(entityId) as
        | Record<string, unknown>
        | undefined,
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
