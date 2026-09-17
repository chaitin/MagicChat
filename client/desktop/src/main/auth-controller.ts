import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { BrowserWindow, safeStorage, session, type Session } from "electron"
import {
  AuthFailure,
  OFFICIAL_SERVER_ID,
  OFFICIAL_SERVER_URL,
  isRecord,
  normalizeEmail,
  normalizeServer,
  normalizeServerName,
  type AppInfo,
  type AuthResult,
  type AuthUser,
  type CodeResult,
  type Connection,
  type ServerPreference,
  type ServerCatalog,
  type ServerCheck,
  type ServerProfile,
  type SaveServerInput,
  type RestoredSession,
  type SignInInput,
  type SignInResult,
  type SavedLogin,
  type ThirdPartyProvider,
  type ThirdPartySignInInput,
} from "../shared/auth"
import type {
  AccountDataChangedEvent,
  AccountDataSyncEvent,
  AvatarRequest,
  AvatarResult,
  DesktopContactDirectory,
  DesktopConversation,
  DesktopMessage,
  DesktopMessagePage,
  DesktopMessageReactionUser,
  MessageReactionUsersInput,
  RetryMessageInput,
  SendImageMessageInput,
  SendTextMessageInput,
  SendVideoMessageInput,
  SetMessageReactionInput,
} from "../shared/account-data"
import {
  DEFAULT_SHORTCUTS,
  type AppSettings,
  type NotificationSettings,
  type ShortcutSettings,
  type ThemePreference,
} from "../shared/desktop"
import { AccountRuntime } from "./account/account-runtime"
import type { CachedMedia, MediaCacheRequest, MediaDownloadProgress } from "../shared/media"
import type { AvatarResource } from "./account/avatar-types"

type StoredLogin = {
  method: "password" | "email-code"
  email: string
  encryptedPassword?: string
}
type StoredAccountSession = {
  serverId: string
  userId: string
  userEmail: string
  userName: string
  token: string
  expiresAt: string
  lastUsedAt: number
}
type AppConfig = {
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
type NativeSessionCredential = { token: string; expiresAt: string }
type ActiveConnection = Connection & {
  session: Session
  credential: NativeSessionCredential | null
}
type RequestOptions = {
  headers?: Record<string, string>
  omitOrigin?: boolean
  credentials?: "include" | "omit"
}
const NATIVE_SESSION_HEADER = "X-Dianbao-Mobile-Session"
const NATIVE_SESSION_VERSION = "1"
const USER_SESSION_COOKIE = "user_session"
const THIRD_PARTY_STATE_COOKIE = "third_party_login_state"
const THIRD_PARTY_REDIRECT_PATH = "/init"
const THIRD_PARTY_TIMEOUT_MS = 5 * 60_000
const MAX_RESPONSE_BYTES = 128 * 1024
const MAX_SERVERS = 20
const officialServer: ServerProfile = {
  id: OFFICIAL_SERVER_ID,
  name: "演示服务器",
  url: OFFICIAL_SERVER_URL,
  builtin: true,
}

export class AuthController {
  private readonly filePath: string
  private readonly initialized: Promise<void>
  private config: AppConfig = {
    version: 1,
    theme: "system",
    shortcuts: { ...DEFAULT_SHORTCUTS },
    notifications: { soundEnabled: true, desktopEnabled: true },
    activeServerId: OFFICIAL_SERVER_ID,
    servers: [officialServer],
    serverLogins: {},
    accountSessions: {},
    lastAccountKey: null,
  }
  private active?: ActiveConnection
  private accountRuntime?: AccountRuntime
  private busy = false
  private readonly cooldowns = new Map<string, number>()

  constructor(
    private readonly userDataPath: string,
    private readonly accountEvents: {
      onSyncStateChange: (event: AccountDataSyncEvent) => void
      onDataChanged: (event: AccountDataChangedEvent) => void
      onMediaProgress: (event: MediaDownloadProgress) => void
    } = {
      onSyncStateChange: () => undefined,
      onDataChanged: () => undefined,
      onMediaProgress: () => undefined,
    },
  ) {
    this.filePath = path.join(userDataPath, "app-config.json")
    this.initialized = this.loadConfig()
  }

  async getServer(): Promise<ServerProfile> {
    await this.initialized
    return { ...this.getProfile(this.config.activeServerId) }
  }

  async getServers(): Promise<ServerCatalog> {
    await this.initialized
    return this.catalog()
  }

  restoreLastSession(): Promise<RestoredSession> {
    return this.exclusive(async () => {
      const accountKey = this.config.lastAccountKey
      const stored = accountKey ? this.config.accountSessions[accountKey] : undefined
      if (!accountKey || !stored) return { catalog: this.catalog(), connection: null }

      const profile = this.config.servers.find((server) => server.id === stored.serverId)
      const token = stored.token
      if (!profile || !token || Date.parse(stored.expiresAt) <= Date.now()) {
        await this.forgetStoredAccount(accountKey)
        return { catalog: this.catalog(), connection: null }
      }

      const serverSession = this.serverSession(profile.url)
      try {
        const [infoData, accountData] = await Promise.all([
          request(serverSession, profile.url, "/api/client/info", undefined, 3_000, {
            omitOrigin: true,
            credentials: "omit",
          }),
          request(serverSession, profile.url, "/api/client/me", undefined, 8_000, {
            headers: { Authorization: `Bearer ${token}` },
            omitOrigin: true,
            credentials: "omit",
          }),
        ])
        const info = parseAppInfo(infoData)
        const user = parseUser(accountData)
        if (user.id !== stored.userId) throw new AuthFailure("unauthorized", "登录已失效")
        const connection: Connection = {
          targetId: randomUUID(),
          server: { ...profile },
          info,
          user,
          savedLogin: this.readSavedLogin(profile.id),
        }
        this.destroyAccountRuntime()
        this.active = {
          ...connection,
          session: serverSession,
          credential: { token, expiresAt: stored.expiresAt },
        }
        this.createAccountRuntime(this.active)
        const accountSessions = {
          ...this.config.accountSessions,
          [accountKey]: {
            ...stored,
            userEmail: user.email,
            userName: user.name,
            lastUsedAt: Date.now(),
          },
        }
        const config = {
          ...this.config,
          activeServerId: profile.id,
          accountSessions,
          lastAccountKey: accountKey,
        }
        await this.saveConfig(config)
        this.config = config
        return { catalog: this.catalog(), connection }
      } catch (error) {
        if (error instanceof AuthFailure && error.code === "unauthorized") {
          await this.forgetStoredAccount(accountKey)
          return { catalog: this.catalog(), connection: null }
        }
        throw error
      }
    })
  }

  async getAppSettings(): Promise<AppSettings> {
    await this.initialized
    return {
      theme: this.config.theme,
      shortcuts: { ...this.config.shortcuts },
      notifications: { ...this.config.notifications },
    }
  }

  async initializeAccountData(targetId: string): Promise<null> {
    await this.initialized
    const active = this.requireTarget(targetId)
    const runtime = this.accountRuntime
    if (!active.user || !active.credential || !runtime) {
      throw new AuthFailure("not_authenticated", "请重新登录账号")
    }
    return this.initializeAccountRuntime(active, runtime)
  }

  async listConversations(targetId: string): Promise<DesktopConversation[]> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().listConversations()
  }

  async listMessages(targetId: string, conversationId: string): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().listMessages(conversationId)
  }

  async loadBeforeMessages(
    targetId: string,
    conversationId: string,
    beforeSeq: number,
  ): Promise<DesktopMessagePage> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().loadBeforeMessages(conversationId, beforeSeq)
  }

  async sendTextMessage(input: SendTextMessageInput): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().sendTextMessage(
      input.conversationId,
      input.content,
      input.bodyType,
    )
  }

  async sendFileMessage(
    input: { targetId: string; conversationId: string },
    file: { path: string; name: string; sizeBytes: number },
  ): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().sendFileMessage(input.conversationId, file)
  }

  async sendImageMessage(
    input: SendImageMessageInput,
    image: { path: string; sizeBytes: number },
  ): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().sendImageMessage(input.conversationId, {
      path: image.path,
      name: input.name,
      sizeBytes: image.sizeBytes,
      contentType: input.contentType,
      width: input.width,
      height: input.height,
      caption: input.caption,
    })
  }

  async sendVideoMessage(
    input: SendVideoMessageInput,
    video: {
      path: string
      name: string
      sizeBytes: number
      contentType: "video/mp4" | "video/webm"
    },
  ): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().sendVideoMessage(input.conversationId, {
      ...video,
      caption: input.caption,
    })
  }

  async retryMessage(input: RetryMessageInput): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().retryMessage(input.conversationId, input.clientMessageId)
  }

  async listMessageReactionUsers(
    input: MessageReactionUsersInput,
  ): Promise<DesktopMessageReactionUser[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().listMessageReactionUsers(input)
  }

  async setMessageReaction(input: SetMessageReactionInput): Promise<DesktopMessage[]> {
    await this.initialized
    this.requireTarget(input?.targetId)
    return this.requireAccountRuntime().setMessageReaction(input)
  }

  async ensureMediaCached(request: MediaCacheRequest): Promise<CachedMedia> {
    await this.initialized
    this.requireTarget(request?.targetId)
    return this.requireAccountRuntime().ensureMediaCached(request)
  }

  async getOutgoingMedia(targetId: string, clientMessageId: string) {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().getOutgoingMedia(clientMessageId)
  }

  async readOutgoingMedia(targetId: string, clientMessageId: string, range?: string) {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().readOutgoingMedia(clientMessageId, range)
  }

  async getCachedMedia(targetId: string, cacheKey: string): Promise<CachedMedia> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().getCachedMedia(cacheKey)
  }

  async readCachedMedia(targetId: string, cacheKey: string, range?: string): Promise<Response> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().readCachedMedia(cacheKey, range)
  }

  async fetchTemporaryFile(targetId: string, fileId: string, range?: string): Promise<Response> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().fetchTemporaryFile(fileId, range)
  }

  async getContacts(targetId: string): Promise<DesktopContactDirectory> {
    await this.initialized
    this.requireTarget(targetId)
    return this.requireAccountRuntime().getContacts()
  }

  async getAvatar(request: AvatarRequest): Promise<AvatarResult> {
    await this.initialized
    this.requireTarget(request?.targetId)
    return this.requireAccountRuntime().getAvatar({
      type: request.type,
      id: request.id,
      theme: request.theme,
    })
  }

  async invalidateAvatar(request: Omit<AvatarRequest, "theme">): Promise<null> {
    await this.initialized
    this.requireTarget(request?.targetId)
    await this.requireAccountRuntime().invalidateAvatar(request.type, request.id)
    return null
  }

  async readAvatarResource(resourceKey: string): Promise<AvatarResource> {
    await this.initialized
    return this.requireAccountRuntime().readAvatarResource(resourceKey)
  }

  close() {
    this.destroyAccountRuntime()
  }

  setTheme(theme: ThemePreference): Promise<null> {
    return this.exclusive(async () => {
      if (!["light", "dark", "system"].includes(theme)) {
        throw new AuthFailure("invalid_theme", "主题设置不受支持")
      }
      if (theme === this.config.theme) return null
      const config = { ...this.config, theme }
      await this.saveConfig(config)
      this.config = config
      return null
    })
  }

  setNotificationSettings(settings: NotificationSettings): Promise<null> {
    return this.exclusive(async () => {
      if (
        !isRecord(settings) ||
        typeof settings.soundEnabled !== "boolean" ||
        typeof settings.desktopEnabled !== "boolean"
      ) {
        throw new AuthFailure("invalid_notification_settings", "通知设置不正确")
      }
      const config = {
        ...this.config,
        notifications: {
          soundEnabled: settings.soundEnabled,
          desktopEnabled: settings.desktopEnabled,
        },
      }
      await this.saveConfig(config)
      this.config = config
      return null
    })
  }

  setShortcutSettings(shortcuts: ShortcutSettings): Promise<null> {
    return this.exclusive(async () => {
      if (
        !isRecord(shortcuts) ||
        typeof shortcuts.showWindow !== "string" ||
        typeof shortcuts.screenshot !== "string" ||
        shortcuts.showWindow.length > 64 ||
        shortcuts.screenshot.length > 64
      ) {
        throw new AuthFailure("invalid_shortcut", "快捷键设置不正确")
      }
      const config = { ...this.config, shortcuts: { ...shortcuts } }
      await this.saveConfig(config)
      this.config = config
      return null
    })
  }

  saveServer(input: SaveServerInput): Promise<{ catalog: ServerCatalog; check: ServerCheck }> {
    return this.exclusive(async () => {
      const name = normalizeServerName(input?.name)
      const server = normalizeServer(input)
      const existing = input.id ? this.getProfile(input.id) : undefined
      if (existing?.builtin) throw new AuthFailure("builtin_server", "官方服务器不能修改")
      if (!existing && this.config.servers.length >= MAX_SERVERS)
        throw new AuthFailure("server_limit", `最多保存 ${MAX_SERVERS} 个服务器`)
      if (
        this.config.servers.some(
          (item) => item.url === server.url && (!existing || item.id !== existing.id),
        )
      ) {
        throw new AuthFailure("duplicate_server", "该服务器地址已存在")
      }
      if (existing && existing.id === this.config.activeServerId && existing.url !== server.url) {
        throw new AuthFailure(
          "active_server",
          "请先返回服务器选择页并切换服务器，再修改当前服务器地址",
        )
      }
      const profile: ServerProfile = {
        id: existing?.id ?? randomUUID(),
        name,
        ...server,
        builtin: false,
      }
      const servers = existing
        ? this.config.servers.map((item) => (item.id === existing.id ? profile : item))
        : [...this.config.servers, profile]
      const serverLogins = { ...this.config.serverLogins }
      const accountSessions = { ...this.config.accountSessions }
      if (existing && existing.url !== profile.url) {
        delete serverLogins[existing.id]
        for (const [key, account] of Object.entries(accountSessions)) {
          if (account.serverId === existing.id) delete accountSessions[key]
        }
      }
      const lastAccountKey =
        this.config.lastAccountKey && accountSessions[this.config.lastAccountKey]
          ? this.config.lastAccountKey
          : null
      const config = { ...this.config, servers, serverLogins, accountSessions, lastAccountKey }
      await this.saveConfig(config)
      this.config = config
      if (this.active?.server.id === profile.id) this.active.server = { ...profile }
      return { catalog: this.catalog(), check: await this.inspect(profile) }
    })
  }

  deleteServer(id: string): Promise<ServerCatalog> {
    return this.exclusive(async () => {
      const profile = this.getProfile(id)
      if (profile.builtin) throw new AuthFailure("builtin_server", "官方服务器不能删除")
      if (profile.id === this.config.activeServerId)
        throw new AuthFailure("active_server", "请先返回服务器选择页并切换服务器，再删除当前服务器")
      const serverLogins = { ...this.config.serverLogins }
      delete serverLogins[profile.id]
      const accountSessions = Object.fromEntries(
        Object.entries(this.config.accountSessions).filter(
          ([, account]) => account.serverId !== profile.id,
        ),
      )
      const lastAccountKey =
        this.config.lastAccountKey && accountSessions[this.config.lastAccountKey]
          ? this.config.lastAccountKey
          : null
      const config = {
        ...this.config,
        servers: this.config.servers.filter((item) => item.id !== profile.id),
        serverLogins,
        accountSessions,
        lastAccountKey,
      }
      await this.saveConfig(config)
      this.config = config
      return this.catalog()
    })
  }

  async checkServer(id: string): Promise<ServerCheck> {
    await this.initialized
    return this.inspect(this.getProfile(id))
  }

  async checkServers(): Promise<ServerCheck[]> {
    await this.initialized
    const servers = [...this.config.servers]
    return Promise.all(servers.map((item) => this.inspect(item)))
  }

  connect(serverId: string): Promise<Connection> {
    return this.exclusive(async () => {
      const profile = this.getProfile(serverId)
      const server = normalizeServer(profile)
      // 即使地址只差端口或部署路径，也使用独立网络会话隔离服务器状态。
      const serverSession = this.serverSession(server.url)
      const data = await request(serverSession, server.url, "/api/client/info", undefined, 3_000, {
        omitOrigin: true,
        credentials: "omit",
      })
      const info = parseAppInfo(data)
      const connection: Connection = {
        targetId: randomUUID(),
        server: { ...profile, ...server },
        info,
        user: null,
        savedLogin: this.readSavedLogin(profile.id),
      }
      const config = { ...this.config, activeServerId: profile.id }
      await this.saveConfig(config)
      this.config = config
      this.destroyAccountRuntime()
      this.active = { ...connection, session: serverSession, credential: null }
      return connection
    })
  }

  sendCode(input: { targetId: string; email: string }): Promise<CodeResult> {
    return this.exclusive(async () => {
      const active = this.requireTarget(input?.targetId)
      if (!active.info.emailCodeLoginEnabled)
        throw new AuthFailure("method_disabled", "服务器未启用验证码登录")
      const email = normalizeEmail(input.email)
      const key = `${active.server.url}\n${email.toLowerCase()}`
      const remaining = Math.ceil(((this.cooldowns.get(key) ?? 0) - Date.now()) / 1000)
      if (remaining > 0) throw new AuthFailure("rate_limited", "请稍后再获取验证码", remaining)
      try {
        const data = await request(
          active.session,
          active.server.url,
          "/api/client/auth/email-code/request",
          { email },
        )
        if (
          !isRecord(data) ||
          !validSeconds(data.expires_in_seconds, 1) ||
          !validSeconds(data.retry_after_seconds, 0)
        ) {
          throw invalidResponse()
        }
        this.cooldowns.set(key, Date.now() + data.retry_after_seconds * 1000)
        return {
          expiresInSeconds: data.expires_in_seconds,
          retryAfterSeconds: data.retry_after_seconds,
        }
      } catch (error) {
        if (error instanceof AuthFailure && error.retryAfterSeconds)
          this.cooldowns.set(key, Date.now() + error.retryAfterSeconds * 1000)
        throw error
      }
    })
  }

  signIn(input: SignInInput): Promise<SignInResult> {
    return this.exclusive(async () => {
      const active = this.requireTarget(input?.targetId)
      if (active.user)
        throw new AuthFailure("already_authenticated", "当前账号已登录，请先退出登录")
      const email = normalizeEmail(input.email)
      const password = input.method === "password"
      if (
        !(password
          ? active.info.passwordLoginEnabled
          : input.method === "email-code" && active.info.emailCodeLoginEnabled)
      ) {
        throw new AuthFailure("method_disabled", "服务器未启用此登录方式")
      }
      if (
        typeof input.secret !== "string" ||
        (password ? !input.secret || input.secret.length > 4096 : !/^\d{8}$/.test(input.secret))
      ) {
        throw new AuthFailure("invalid_secret", password ? "请输入密码" : "请输入 8 位数字验证码")
      }
      let user: AuthUser
      let credential: NativeSessionCredential | null = null
      try {
        const data = await request(
          active.session,
          active.server.url,
          password ? "/api/client/auth/login" : "/api/client/auth/email-code/login",
          password ? { email, password: input.secret } : { email, code: input.secret },
          15_000,
          {
            headers: { [NATIVE_SESSION_HEADER]: NATIVE_SESSION_VERSION },
            omitOrigin: true,
            credentials: "omit",
          },
        )
        const nativeSession = parseNativeSession(data)
        credential = nativeSession.credential
        user = parseUser(
          await request(active.session, active.server.url, "/api/client/me", undefined, 15_000, {
            headers: { Authorization: `Bearer ${nativeSession.credential.token}` },
            omitOrigin: true,
            credentials: "omit",
          }),
        )
        if (nativeSession.user.id !== user.id)
          throw new AuthFailure("invalid_session", "登录会话与账号不一致，请重试")
        active.credential = credential
        await active.session.clearStorageData({ storages: ["cookies"] })
        await active.session.cookies.flushStore()
      } catch (error) {
        active.credential = null
        if (credential) {
          await request(active.session, active.server.url, "/api/client/auth/logout", {}, 15_000, {
            headers: { Authorization: `Bearer ${credential.token}` },
            omitOrigin: true,
            credentials: "omit",
          }).catch(() => undefined)
        }
        await active.session.clearStorageData({ storages: ["cookies"] })
        await active.session.cookies.flushStore()
        throw error
      }
      active.user = user
      const savedLogin: StoredLogin = { method: input.method, email }
      if (password) {
        const encryptedPassword = this.encryptPassword(input.secret)
        if (encryptedPassword) savedLogin.encryptedPassword = encryptedPassword
      }
      const config = this.withRememberedAccount(
        {
          ...this.config,
          serverLogins: { ...this.config.serverLogins, [active.server.id]: savedLogin },
        },
        active,
      )
      try {
        await this.saveConfig(config)
        this.config = config
        active.savedLogin = this.readSavedLogin(active.server.id)
      } catch {
        // 登录信息记忆失败不影响已建立的认证会话。
      }
      this.createAccountRuntime(active)
      return { user, savedLogin: active.savedLogin }
    })
  }

  signInThirdParty(input: ThirdPartySignInInput, parent: BrowserWindow): Promise<SignInResult> {
    return this.exclusive(async () => {
      const active = this.requireTarget(input?.targetId)
      if (active.user)
        throw new AuthFailure("already_authenticated", "当前账号已登录，请先退出登录")
      const provider = active.info.thirdPartyProviders.find(
        (item) => item.key === input?.providerKey,
      )
      if (!provider) throw new AuthFailure("invalid_provider", "第三方登录方式不存在或已停用")

      await this.clearServerAuthCookies(active.session, active.server.url)
      let credential: NativeSessionCredential | null = null
      try {
        credential = await this.openThirdPartyWindow(active, provider, parent)
        const user = parseUser(
          await request(active.session, active.server.url, "/api/client/me", undefined, 15_000, {
            headers: { Authorization: `Bearer ${credential.token}` },
            omitOrigin: true,
            credentials: "omit",
          }),
        )
        active.credential = credential
        active.user = user
        await this.clearServerAuthCookies(active.session, active.server.url)
        try {
          const config = this.withRememberedAccount(this.config, active)
          await this.saveConfig(config)
          this.config = config
        } catch {
          // Token 记忆失败不影响已建立的认证会话。
        }
        this.createAccountRuntime(active)
        return { user }
      } catch (error) {
        active.credential = null
        if (credential) await this.revokeCredential(active, credential)
        await this.clearServerAuthCookies(active.session, active.server.url)
        throw error
      }
    })
  }

  signOut(targetId: string): Promise<null> {
    return this.exclusive(async () => {
      const active = this.requireTarget(targetId)
      const accountKey = active.user ? this.accountKey(active.server.url, active.user.id) : null
      this.destroyAccountRuntime()
      try {
        await request(active.session, active.server.url, "/api/client/auth/logout", {}, 15_000, {
          headers: active.credential
            ? { Authorization: `Bearer ${active.credential.token}` }
            : undefined,
          omitOrigin: Boolean(active.credential),
          credentials: active.credential ? "omit" : "include",
        })
      } catch {
        // 无论服务端是否响应，都清理本地认证状态。
      }
      await active.session.clearStorageData({ storages: ["cookies"] })
      await active.session.cookies.flushStore()
      if (accountKey) await this.forgetStoredAccount(accountKey).catch(() => undefined)
      active.user = null
      active.credential = null
      return null
    })
  }

  private openThirdPartyWindow(
    active: ActiveConnection,
    provider: ThirdPartyProvider,
    parent: BrowserWindow,
  ): Promise<NativeSessionCredential> {
    const serverOrigin = new URL(active.server.url).origin
    const redirectPath = `${THIRD_PARTY_REDIRECT_PATH}?desktop-auth=complete`
    const startUrl = new URL(
      `${active.server.url}/api/client/auth/third-party/${encodeURIComponent(provider.key)}/start`,
    )
    startUrl.searchParams.set("redirect", redirectPath)

    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        parent,
        modal: true,
        width: 520,
        height: 720,
        minWidth: 420,
        minHeight: 560,
        title: `使用 ${provider.name} 登录`,
        show: false,
        webPreferences: {
          session: active.session,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      })
      authWindow.removeMenu()
      authWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      authWindow.webContents.on("will-navigate", (event, targetUrl) => {
        try {
          if (!/^https?:$/.test(new URL(targetUrl).protocol)) event.preventDefault()
        } catch {
          event.preventDefault()
        }
      })

      let settled = false
      const timer = setTimeout(
        () =>
          finish(() => reject(new AuthFailure("third_party_timeout", "第三方登录超时，请重试"))),
        THIRD_PARTY_TIMEOUT_MS,
      )
      const finish = (complete: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!authWindow.isDestroyed()) authWindow.destroy()
        complete()
      }
      const completeFromNavigation = async (targetUrl: string) => {
        if (settled) return
        let url: URL
        try {
          url = new URL(targetUrl)
        } catch {
          return
        }
        if (
          url.origin !== serverOrigin ||
          url.pathname !== THIRD_PARTY_REDIRECT_PATH ||
          url.searchParams.get("desktop-auth") !== "complete"
        ) {
          return
        }
        try {
          const cookies = await active.session.cookies.get({
            url: `${serverOrigin}/`,
            name: USER_SESSION_COOKIE,
          })
          const cookie = cookies.find(
            (item) =>
              Boolean(item.value) &&
              typeof item.expirationDate === "number" &&
              item.expirationDate * 1_000 > Date.now(),
          )
          if (!cookie?.value || cookie.value.length > 8_192 || !cookie.expirationDate) {
            throw new AuthFailure("invalid_session", "第三方登录未返回有效凭据")
          }
          finish(() =>
            resolve({
              token: cookie.value,
              expiresAt: new Date(cookie.expirationDate! * 1_000).toISOString(),
            }),
          )
        } catch (error) {
          finish(() => reject(error))
        }
      }

      authWindow.once("ready-to-show", () => authWindow.show())
      authWindow.once("closed", () => {
        if (!settled)
          finish(() => reject(new AuthFailure("third_party_cancelled", "已取消第三方登录")))
      })
      authWindow.webContents.on("did-navigate", (_event, targetUrl) => {
        void completeFromNavigation(targetUrl)
      })
      void authWindow.loadURL(startUrl.toString()).catch((error) => {
        finish(() =>
          reject(
            new AuthFailure(
              "third_party_unavailable",
              error instanceof Error ? "无法打开第三方登录页面，请重试" : "第三方登录不可用",
            ),
          ),
        )
      })
    })
  }

  private async clearServerAuthCookies(serverSession: Session, serverUrl: string) {
    const origin = new URL(serverUrl).origin
    await Promise.allSettled([
      serverSession.cookies.remove(`${origin}/`, USER_SESSION_COOKIE),
      serverSession.cookies.remove(
        `${origin}/api/client/auth/third-party/`,
        THIRD_PARTY_STATE_COOKIE,
      ),
    ])
    await serverSession.cookies.flushStore()
  }

  private async revokeCredential(active: ActiveConnection, credential: NativeSessionCredential) {
    await request(active.session, active.server.url, "/api/client/auth/logout", {}, 15_000, {
      headers: { Authorization: `Bearer ${credential.token}` },
      omitOrigin: true,
      credentials: "omit",
    }).catch(() => undefined)
  }

  private catalog(): ServerCatalog {
    return {
      activeServerId: this.config.activeServerId,
      servers: this.config.servers.map((item) => ({ ...item })),
    }
  }

  private getProfile(id: unknown): ServerProfile {
    if (typeof id !== "string") throw new AuthFailure("invalid_server", "服务器不存在")
    const profile = this.config.servers.find((item) => item.id === id)
    if (!profile) throw new AuthFailure("invalid_server", "服务器不存在或已被删除")
    return profile
  }

  private serverSession(serverUrl: string): Session {
    const partition = `persist:jiying-auth-${createHash("sha256").update(serverUrl).digest("hex")}`
    const serverSession = session.fromPartition(partition)
    serverSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    serverSession.setPermissionCheckHandler(() => false)
    return serverSession
  }

  private async inspect(profile: ServerProfile): Promise<ServerCheck> {
    const checkedAt = Date.now()
    try {
      const data = await request(
        this.serverSession(profile.url),
        profile.url,
        "/api/client/info",
        undefined,
        3_000,
      )
      const info = parseAppInfo(data)
      return {
        serverId: profile.id,
        status: "available",
        checkedAt,
        organizationName: info.organizationName,
      }
    } catch (error) {
      return {
        serverId: profile.id,
        status: "unavailable",
        checkedAt,
        message: error instanceof AuthFailure ? error.message : "检测失败，请稍后重试",
      }
    }
  }

  private async initializeAccountRuntime(active: ActiveConnection, runtime: AccountRuntime) {
    try {
      await runtime.initialize()
      return null
    } catch (error) {
      if (this.accountRuntime === runtime) {
        const credential = active.credential
        const accountKey = active.user ? this.accountKey(active.server.url, active.user.id) : null
        this.destroyAccountRuntime()
        active.user = null
        active.credential = null
        if (credential) {
          await Promise.allSettled([
            this.revokeCredential(active, credential),
            this.clearServerAuthCookies(active.session, active.server.url),
            ...(accountKey ? [this.forgetStoredAccount(accountKey)] : []),
          ])
        }
      }
      throw error
    }
  }

  private createAccountRuntime(active: ActiveConnection) {
    if (!active.user || !active.credential) {
      throw new AuthFailure("not_authenticated", "请重新登录账号")
    }
    this.destroyAccountRuntime()
    this.accountRuntime = new AccountRuntime({
      userDataPath: this.userDataPath,
      targetId: active.targetId,
      serverUrl: active.server.url,
      userId: active.user.id,
      userName: active.user.name,
      userAvatar: active.user.avatar,
      session: active.session,
      token: active.credential.token,
      onSyncStateChange: this.accountEvents.onSyncStateChange,
      onDataChanged: this.accountEvents.onDataChanged,
      onMediaProgress: this.accountEvents.onMediaProgress,
    })
  }

  private requireAccountRuntime(): AccountRuntime {
    if (!this.accountRuntime) {
      throw new AuthFailure("account_not_ready", "账号数据尚未初始化")
    }
    return this.accountRuntime
  }

  private destroyAccountRuntime() {
    this.accountRuntime?.close()
    this.accountRuntime = undefined
  }

  private requireTarget(targetId: unknown): ActiveConnection {
    if (typeof targetId !== "string" || !this.active || targetId !== this.active.targetId) {
      throw new AuthFailure("stale_target", "服务器连接已变化，请重新连接后登录")
    }
    return this.active
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await this.initialized
    if (this.busy) throw new AuthFailure("busy", "正在处理上一项操作，请稍候")
    this.busy = true
    try {
      return await operation()
    } finally {
      this.busy = false
    }
  }

  private accountKey(serverUrl: string, userId: string): string {
    return createHash("sha256").update(serverUrl).update("\0").update(userId).digest("hex")
  }

  private withRememberedAccount(config: AppConfig, active: ActiveConnection): AppConfig {
    if (!active.user || !active.credential) return config
    const key = this.accountKey(active.server.url, active.user.id)
    return {
      ...config,
      activeServerId: active.server.id,
      lastAccountKey: key,
      accountSessions: {
        ...config.accountSessions,
        [key]: {
          serverId: active.server.id,
          userId: active.user.id,
          userEmail: active.user.email,
          userName: active.user.name,
          token: active.credential.token,
          expiresAt: active.credential.expiresAt,
          lastUsedAt: Date.now(),
        },
      },
    }
  }

  private async forgetStoredAccount(accountKey: string) {
    if (!this.config.accountSessions[accountKey] && this.config.lastAccountKey !== accountKey)
      return
    const accountSessions = { ...this.config.accountSessions }
    delete accountSessions[accountKey]
    const config = {
      ...this.config,
      accountSessions,
      lastAccountKey: this.config.lastAccountKey === accountKey ? null : this.config.lastAccountKey,
    }
    await this.saveConfig(config)
    this.config = config
  }

  private readSavedLogin(serverId: string): SavedLogin | undefined {
    const stored = this.config.serverLogins[serverId]
    if (!stored) return undefined
    if (stored.method !== "password" || !stored.encryptedPassword) {
      return { method: stored.method, email: stored.email }
    }
    if (!this.canProtectPassword()) return { method: stored.method, email: stored.email }
    try {
      return {
        method: stored.method,
        email: stored.email,
        password: safeStorage.decryptString(Buffer.from(stored.encryptedPassword, "base64")),
      }
    } catch {
      return { method: stored.method, email: stored.email }
    }
  }

  private encryptPassword(password: string): string | undefined {
    if (!this.canProtectPassword()) return undefined
    try {
      return safeStorage.encryptString(password).toString("base64")
    } catch {
      return undefined
    }
  }

  private canProtectPassword(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
  }

  private async loadConfig() {
    try {
      const stored: unknown = JSON.parse(await readFile(this.filePath, "utf8"))
      if (!isRecord(stored) || stored.version !== 1 || !Array.isArray(stored.servers)) return

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
          if (!accountServer || this.accountKey(accountServer.url, value.userId) !== key) continue
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
      }
      const theme =
        stored.theme === "light" || stored.theme === "dark" || stored.theme === "system"
          ? stored.theme
          : "system"
      const activeServerId =
        typeof stored.activeServerId === "string" && ids.has(stored.activeServerId)
          ? stored.activeServerId
          : OFFICIAL_SERVER_ID
      const notifications = isRecord(stored.notifications)
        ? {
            soundEnabled:
              typeof stored.notifications.soundEnabled === "boolean"
                ? stored.notifications.soundEnabled
                : true,
            desktopEnabled:
              typeof stored.notifications.desktopEnabled === "boolean"
                ? stored.notifications.desktopEnabled
                : true,
          }
        : { soundEnabled: true, desktopEnabled: true }
      this.config = {
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
      // 缺失或损坏的配置不阻断应用启动。
    }
  }

  private async saveConfig(config: AppConfig) {
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await writeFile(`${this.filePath}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 })
      await rename(`${this.filePath}.tmp`, this.filePath)
    } catch {
      throw new AuthFailure("storage", "无法保存登录配置，请检查用户数据目录的写入权限")
    }
  }
}

export async function authResult<T>(operation: () => Promise<T>): Promise<AuthResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AuthFailure
          ? { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds }
          : { code: "internal", message: "操作未完成，请重试" },
    }
  }
}

async function request(
  serverSession: Session,
  serverUrl: string,
  endpoint: string,
  body?: Record<string, string>,
  timeoutMs = 15_000,
  options: RequestOptions = {},
): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await serverSession.fetch(`${serverUrl}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        ...(options.omitOrigin ? {} : { Origin: new URL(serverUrl).origin }),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: options.credentials ?? "include",
      redirect: "error",
      signal,
    })
    if (response.status === 401)
      throw new AuthFailure(
        "unauthorized",
        endpoint === "/api/client/auth/login"
          ? "账号或密码错误"
          : endpoint.endsWith("email-code/login")
            ? "验证码无效或已过期"
            : "登录已失效，请重新登录",
      )
    const reader = response.body?.getReader()
    if (!reader) throw invalidResponse()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_RESPONSE_BYTES) throw invalidResponse()
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      throw invalidResponse()
    }
    if (!response.ok || !isRecord(envelope) || envelope.success !== true) {
      const error = isRecord(envelope) && isRecord(envelope.error) ? envelope.error : null
      const message =
        typeof error?.message === "string" && error.message.trim()
          ? error.message.slice(0, 240)
          : "服务器暂时无法完成请求，请稍后重试"
      const rawRetry = response.headers.get("retry-after")
      const retry = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : 0
      throw new AuthFailure(
        response.status === 429 ? "rate_limited" : "server_error",
        message,
        validSeconds(retry, 1) ? retry : undefined,
      )
    }
    return envelope.data
  } catch (error) {
    if (signal.aborted) throw new AuthFailure("timeout", "连接超时，请检查服务器地址或网络后重试")
    if (error instanceof AuthFailure) throw error
    if (error instanceof Error && /certificate|tls|ssl/i.test(error.message))
      throw new AuthFailure("tls", "服务器证书验证失败，请联系管理员检查 HTTPS 配置")
    throw new AuthFailure("network", "无法连接服务器，请检查地址、网络和 HTTPS 配置")
  }
}

function parseAppInfo(data: unknown): AppInfo {
  if (!isRecord(data) || !validText(data.app_name) || !validText(data.organization_name))
    throw invalidResponse()
  return {
    appName: data.app_name.trim(),
    organizationName: data.organization_name.trim(),
    emailCodeLoginEnabled: data.email_code_login_enabled === true,
    passwordLoginEnabled: data.password_login_enabled !== false,
    thirdPartyProviders: parseThirdPartyProviders(
      data.third_party_providers ?? data.oidc_providers,
    ),
  }
}

function parseThirdPartyProviders(value: unknown): ThirdPartyProvider[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 20) throw invalidResponse()
  const keys = new Set<string>()
  return value.map((provider) => {
    if (
      !isRecord(provider) ||
      typeof provider.key !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(provider.key) ||
      !validText(provider.name) ||
      keys.has(provider.key)
    ) {
      throw invalidResponse()
    }
    keys.add(provider.key)
    return { key: provider.key, name: provider.name.trim() }
  })
}

function parseNativeSession(data: unknown): {
  credential: NativeSessionCredential
  user: AuthUser
} {
  if (!isRecord(data) || !isRecord(data.mobile_session)) {
    throw new AuthFailure(
      "native_session_unsupported",
      "服务器不支持桌面客户端 Token 登录，请升级服务器后重试",
    )
  }
  const token = data.mobile_session.token
  const expiresAt = data.mobile_session.expires_at
  if (
    typeof token !== "string" ||
    !token ||
    token.length > 8_192 ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new AuthFailure("invalid_session", "服务器返回的登录凭据格式不正确")
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new AuthFailure("expired_session", "服务器返回的登录凭据已过期")
  }
  return { credential: { token, expiresAt }, user: parseUser(data) }
}

function parseUser(data: unknown): AuthUser {
  if (
    !isRecord(data) ||
    !isRecord(data.user) ||
    !validText(data.user.id) ||
    !validText(data.user.email) ||
    !validText(data.user.name)
  )
    throw invalidResponse()
  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    avatar: typeof data.user.avatar === "string" ? data.user.avatar : "",
  }
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300
}
function validSeconds(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 86_400
}
function invalidResponse() {
  return new AuthFailure("invalid_response", "服务器返回的数据格式不正确，请确认这是即应服务器")
}
