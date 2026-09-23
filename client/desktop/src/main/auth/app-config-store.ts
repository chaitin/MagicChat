import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  AuthFailure,
  OFFICIAL_SERVER_ID,
  OFFICIAL_SERVER_URL,
  isRecord,
  normalizeEmail,
  normalizeServer,
  normalizeServerName,
  type ServerPreference,
  type ServerProfile,
} from "../../shared/auth"
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  type NotificationSettings,
  type ShortcutSettings,
  type ThemePreference,
} from "../../shared/desktop"

export const MAX_SERVERS = 20

export type StoredLogin = {
  method: "password" | "email-code"
  email: string
  encryptedPassword?: string
}

export type StoredAccountSession = {
  serverId: string
  userId: string
  userEmail: string
  userName: string
  token: string
  expiresAt: string
  lastUsedAt: number
}

export type AppConfig = {
  version: 1
  theme: ThemePreference
  shortcuts: ShortcutSettings
  notifications: NotificationSettings
  activeServerId: string
  servers: ServerProfile[]
  serverLogins: Record<string, StoredLogin>
  accountSessions: Record<string, StoredAccountSession>
  lastAccountKey: string | null
}

const officialServer: ServerProfile = {
  id: OFFICIAL_SERVER_ID,
  name: "演示服务器",
  url: OFFICIAL_SERVER_URL,
  builtin: true,
}

export function createDefaultAppConfig(): AppConfig {
  return {
    version: 1,
    theme: "system",
    shortcuts: { ...DEFAULT_SHORTCUTS },
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    activeServerId: OFFICIAL_SERVER_ID,
    servers: [officialServer],
    serverLogins: {},
    accountSessions: {},
    lastAccountKey: null,
  }
}

export function accountKey(serverUrl: string, userId: string) {
  return createHash("sha256").update(serverUrl).update("\0").update(userId).digest("hex")
}

export class AppConfigStore {
  private readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "app-config.json")
  }

  async load(): Promise<AppConfig> {
    const fallback = createDefaultAppConfig()
    try {
      const stored: unknown = JSON.parse(await readFile(this.filePath, "utf8"))
      if (!isRecord(stored) || stored.version !== 1 || !Array.isArray(stored.servers)) {
        return fallback
      }

      const servers: ServerProfile[] = [officialServer]
      const ids = new Set([OFFICIAL_SERVER_ID])
      const urls = new Set([OFFICIAL_SERVER_URL])
      for (const value of stored.servers.slice(0, MAX_SERVERS)) {
        if (!isRecord(value) || value.builtin === true || typeof value.id !== "string") continue
        if (!value.id || value.id.length > 128 || ids.has(value.id)) continue
        try {
          const name = normalizeServerName(value.name)
          const server = normalizeServer(value as ServerPreference)
          if (urls.has(server.url)) continue
          servers.push({ id: value.id, name, ...server, builtin: false })
          ids.add(value.id)
          urls.add(server.url)
        } catch {
          // 单条损坏配置不影响其余服务器和官方入口。
        }
      }

      const serverLogins: Record<string, StoredLogin> = {}
      if (isRecord(stored.serverLogins)) {
        for (const [serverId, value] of Object.entries(stored.serverLogins).slice(0, MAX_SERVERS)) {
          if (!ids.has(serverId) || !isRecord(value)) continue
          if (value.method !== "password" && value.method !== "email-code") continue
          try {
            const email = normalizeEmail(value.email)
            const encryptedPassword =
              typeof value.encryptedPassword === "string" &&
              value.encryptedPassword.length <= 16_384
                ? value.encryptedPassword
                : undefined
            serverLogins[serverId] = {
              method: value.method,
              email,
              ...(value.method === "password" && encryptedPassword ? { encryptedPassword } : {}),
            }
          } catch {
            // 单条损坏的登录信息不影响服务器和其他配置。
          }
        }
      }

      const accountSessions: Record<string, StoredAccountSession> = {}
      if (isRecord(stored.accountSessions)) {
        for (const [key, value] of Object.entries(stored.accountSessions).slice(0, 100)) {
          if (!/^[a-f0-9]{64}$/.test(key) || !isRecord(value)) continue
          if (
            typeof value.serverId !== "string" ||
            !ids.has(value.serverId) ||
            typeof value.userId !== "string" ||
            !value.userId ||
            value.userId.length > 128 ||
            typeof value.token !== "string" ||
            !value.token ||
            value.token.length > 8_192 ||
            typeof value.expiresAt !== "string" ||
            !Number.isFinite(Date.parse(value.expiresAt)) ||
            typeof value.lastUsedAt !== "number" ||
            !Number.isFinite(value.lastUsedAt)
          ) {
            continue
          }
          const accountServer = servers.find((server) => server.id === value.serverId)
          if (!accountServer || accountKey(accountServer.url, value.userId) !== key) continue
          accountSessions[key] = {
            serverId: value.serverId,
            userId: value.userId,
            userEmail:
              typeof value.userEmail === "string" && value.userEmail.length <= 254
                ? value.userEmail
                : "",
            userName:
              typeof value.userName === "string" && value.userName.length <= 300
                ? value.userName
                : "",
            token: value.token,
            expiresAt: value.expiresAt,
            lastUsedAt: value.lastUsedAt,
          }
        }
      }
      const lastAccountKey =
        typeof stored.lastAccountKey === "string" && accountSessions[stored.lastAccountKey]
          ? stored.lastAccountKey
          : null
      const shortcuts: ShortcutSettings = {
        showWindow:
          isRecord(stored.shortcuts) &&
          typeof stored.shortcuts.showWindow === "string" &&
          stored.shortcuts.showWindow.length <= 64
            ? stored.shortcuts.showWindow
            : DEFAULT_SHORTCUTS.showWindow,
        screenshot:
          isRecord(stored.shortcuts) &&
          typeof stored.shortcuts.screenshot === "string" &&
          stored.shortcuts.screenshot.length <= 64
            ? stored.shortcuts.screenshot
            : DEFAULT_SHORTCUTS.screenshot,
        search:
          isRecord(stored.shortcuts) &&
          typeof stored.shortcuts.search === "string" &&
          stored.shortcuts.search.length <= 64
            ? stored.shortcuts.search
            : DEFAULT_SHORTCUTS.search,
      }
      const theme =
        stored.theme === "light" || stored.theme === "dark" || stored.theme === "system"
          ? stored.theme
          : "system"
      const activeServerId =
        typeof stored.activeServerId === "string" && ids.has(stored.activeServerId)
          ? stored.activeServerId
          : OFFICIAL_SERVER_ID
      const notifications = normalizeNotificationSettings(stored.notifications)
      return {
        version: 1,
        theme,
        shortcuts,
        notifications,
        activeServerId,
        servers,
        serverLogins,
        accountSessions,
        lastAccountKey,
      }
    } catch {
      return fallback
    }
  }

  async save(config: AppConfig) {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(`${this.filePath}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 })
      await rename(`${this.filePath}.tmp`, this.filePath)
    } catch {
      throw new AuthFailure("storage", "无法保存登录配置，请检查用户数据目录的写入权限")
    }
  }
}
