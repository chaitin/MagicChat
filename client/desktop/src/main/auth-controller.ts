import { randomUUID } from "node:crypto"
import { BrowserWindow, type Session } from "electron"
import {
  AuthFailure,
  isRecord,
  normalizeEmail,
  normalizeServer,
  type AuthResult,
  type AuthUser,
  type CodeResult,
  type Connection,
  type ServerCatalog,
  type ServerCheck,
  type ServerProfile,
  type SaveServerInput,
  type RestoredSession,
  type SignInInput,
  type SignInResult,
  type ThirdPartySignInInput,
} from "../shared/auth"
import type {
  AccountDataChangedEvent,
  AccountDataSyncEvent,
  ConversationPresenceEvent,
} from "../shared/account-data"
import {
  type AppSettings,
  type NotificationSettings,
  type ShortcutSettings,
  type ThemePreference,
} from "../shared/desktop"
import { AccountRuntime } from "./account/account-runtime"
import type { MediaDownloadProgress } from "../shared/media"
import { AccountDataFacade } from "./auth/account-data-facade"
import { AppSettingsManager } from "./auth/app-settings-manager"
import {
  accountKey as createAccountKey,
  AppConfigStore,
  createDefaultAppConfig,
  type AppConfig,
  type StoredLogin,
} from "./auth/app-config-store"
import {
  invalidResponse,
  parseAppInfo,
  parseNativeSession,
  parseUser,
  request,
  validSeconds,
  type NativeSessionCredential,
} from "./auth/auth-api"
import { clearServerAuthCookies, openThirdPartyLoginWindow } from "./auth/third-party-auth"
import { encryptPassword, readSavedLogin } from "./auth/login-credential"
import { ServerManager } from "./auth/server-manager"

type ActiveConnection = Connection & {
  session: Session
  credential: NativeSessionCredential | null
}
const NATIVE_SESSION_HEADER = "X-Dianbao-Mobile-Session"
const NATIVE_SESSION_VERSION = "1"

export class AuthController {
  private readonly configStore: AppConfigStore
  private readonly initialized: Promise<void>
  private config: AppConfig = createDefaultAppConfig()
  private active?: ActiveConnection
  private accountRuntime?: AccountRuntime
  private readonly accountData: AccountDataFacade
  private readonly servers: ServerManager
  private readonly settings: AppSettingsManager
  private busy = false
  private readonly cooldowns = new Map<string, number>()

  constructor(
    private readonly userDataPath: string,
    private readonly accountEvents: {
      onSyncStateChange: (event: AccountDataSyncEvent) => void
      onDataChanged: (event: AccountDataChangedEvent) => void
      onConversationPresenceChanged: (event: ConversationPresenceEvent) => void
      onMediaProgress: (event: MediaDownloadProgress) => void
    } = {
      onSyncStateChange: () => undefined,
      onDataChanged: () => undefined,
      onConversationPresenceChanged: () => undefined,
      onMediaProgress: () => undefined,
    },
  ) {
    this.configStore = new AppConfigStore(userDataPath)
    this.servers = new ServerManager(
      this.configStore,
      () => this.config,
      (config) => {
        this.config = config
      },
      (profile) => {
        if (this.active?.server.id === profile.id) this.active.server = { ...profile }
      },
    )
    this.settings = new AppSettingsManager(
      this.configStore,
      () => this.config,
      (config) => {
        this.config = config
      },
    )
    this.initialized = this.configStore.load().then((config) => {
      this.config = config
    })
    this.accountData = new AccountDataFacade(
      () => this.initialized,
      (targetId) => void this.requireTarget(targetId),
      () => this.requireAccountRuntime(),
    )
  }

  async getServer(): Promise<ServerProfile> {
    await this.initialized
    return this.servers.activeProfile()
  }

  async getServers(): Promise<ServerCatalog> {
    await this.initialized
    return this.servers.catalog()
  }

  restoreLastSession(): Promise<RestoredSession> {
    return this.exclusive(async () => {
      const accountKey = this.config.lastAccountKey
      const stored = accountKey ? this.config.accountSessions[accountKey] : undefined
      if (!accountKey || !stored) return { catalog: this.servers.catalog(), connection: null }

      const profile = this.config.servers.find((server) => server.id === stored.serverId)
      const token = stored.token
      if (!profile || !token || Date.parse(stored.expiresAt) <= Date.now()) {
        await this.forgetStoredAccount(accountKey)
        return { catalog: this.servers.catalog(), connection: null }
      }

      const serverSession = this.servers.createSession(profile.url)
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
          savedLogin: readSavedLogin(this.config.serverLogins[profile.id]),
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
        await this.configStore.save(config)
        this.config = config
        return { catalog: this.servers.catalog(), connection }
      } catch (error) {
        if (error instanceof AuthFailure && error.code === "unauthorized") {
          await this.forgetStoredAccount(accountKey)
          return { catalog: this.servers.catalog(), connection: null }
        }
        throw error
      }
    })
  }

  async getAppSettings(): Promise<AppSettings> {
    await this.initialized
    return this.settings.get()
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

  async refreshAll(targetId: string): Promise<null> {
    await this.initialized
    const active = this.requireTarget(targetId)
    const runtime = this.accountRuntime
    if (!active.user || !active.credential || !runtime) {
      throw new AuthFailure("not_authenticated", "请重新登录账号")
    }
    return this.initializeAccountRuntime(active, runtime, () => runtime.refreshAll())
  }

  searchLocal(...args: Parameters<AccountDataFacade["searchLocal"]>) {
    return this.accountData.searchLocal(...args)
  }

  listConversations(...args: Parameters<AccountDataFacade["listConversations"]>) {
    return this.accountData.listConversations(...args)
  }

  createGroupConversation(...args: Parameters<AccountDataFacade["createGroupConversation"]>) {
    return this.accountData.createGroupConversation(...args)
  }

  setConversationPinned(...args: Parameters<AccountDataFacade["setConversationPinned"]>) {
    return this.accountData.setConversationPinned(...args)
  }

  setConversationMuted(...args: Parameters<AccountDataFacade["setConversationMuted"]>) {
    return this.accountData.setConversationMuted(...args)
  }

  dismissConversation(...args: Parameters<AccountDataFacade["dismissConversation"]>) {
    return this.accountData.dismissConversation(...args)
  }

  listMessages(...args: Parameters<AccountDataFacade["listMessages"]>) {
    return this.accountData.listMessages(...args)
  }

  loadBeforeMessages(...args: Parameters<AccountDataFacade["loadBeforeMessages"]>) {
    return this.accountData.loadBeforeMessages(...args)
  }

  sendTextMessage(...args: Parameters<AccountDataFacade["sendTextMessage"]>) {
    return this.accountData.sendTextMessage(...args)
  }

  sendRichMessage(...args: Parameters<AccountDataFacade["sendRichMessage"]>) {
    return this.accountData.sendRichMessage(...args)
  }

  sendFileMessage(...args: Parameters<AccountDataFacade["sendFileMessage"]>) {
    return this.accountData.sendFileMessage(...args)
  }

  sendImageMessage(...args: Parameters<AccountDataFacade["sendImageMessage"]>) {
    return this.accountData.sendImageMessage(...args)
  }

  sendVideoMessage(...args: Parameters<AccountDataFacade["sendVideoMessage"]>) {
    return this.accountData.sendVideoMessage(...args)
  }

  retryMessage(...args: Parameters<AccountDataFacade["retryMessage"]>) {
    return this.accountData.retryMessage(...args)
  }

  createMessageTopic(...args: Parameters<AccountDataFacade["createMessageTopic"]>) {
    return this.accountData.createMessageTopic(...args)
  }

  revokeMessage(...args: Parameters<AccountDataFacade["revokeMessage"]>) {
    return this.accountData.revokeMessage(...args)
  }

  sendConversationStatus(...args: Parameters<AccountDataFacade["sendConversationStatus"]>) {
    return this.accountData.sendConversationStatus(...args)
  }

  listMessageReactionUsers(...args: Parameters<AccountDataFacade["listMessageReactionUsers"]>) {
    return this.accountData.listMessageReactionUsers(...args)
  }

  setMessageReaction(...args: Parameters<AccountDataFacade["setMessageReaction"]>) {
    return this.accountData.setMessageReaction(...args)
  }

  submitChoiceResponse(...args: Parameters<AccountDataFacade["submitChoiceResponse"]>) {
    return this.accountData.submitChoiceResponse(...args)
  }

  ensureMediaCached(...args: Parameters<AccountDataFacade["ensureMediaCached"]>) {
    return this.accountData.ensureMediaCached(...args)
  }

  checkMediaCached(...args: Parameters<AccountDataFacade["checkMediaCached"]>) {
    return this.accountData.checkMediaCached(...args)
  }

  getOutgoingMedia(...args: Parameters<AccountDataFacade["getOutgoingMedia"]>) {
    return this.accountData.getOutgoingMedia(...args)
  }

  readOutgoingMedia(...args: Parameters<AccountDataFacade["readOutgoingMedia"]>) {
    return this.accountData.readOutgoingMedia(...args)
  }

  getCachedMedia(...args: Parameters<AccountDataFacade["getCachedMedia"]>) {
    return this.accountData.getCachedMedia(...args)
  }

  getCachedMediaResource(...args: Parameters<AccountDataFacade["getCachedMediaResource"]>) {
    return this.accountData.getCachedMediaResource(...args)
  }

  readCachedMedia(...args: Parameters<AccountDataFacade["readCachedMedia"]>) {
    return this.accountData.readCachedMedia(...args)
  }

  fetchTemporaryFile(...args: Parameters<AccountDataFacade["fetchTemporaryFile"]>) {
    return this.accountData.fetchTemporaryFile(...args)
  }

  getContacts(...args: Parameters<AccountDataFacade["getContacts"]>) {
    return this.accountData.getContacts(...args)
  }

  refreshContacts(...args: Parameters<AccountDataFacade["refreshContacts"]>) {
    return this.accountData.refreshContacts(...args)
  }

  searchContactUsers(...args: Parameters<AccountDataFacade["searchContactUsers"]>) {
    return this.accountData.searchContactUsers(...args)
  }

  listFriendRequests(...args: Parameters<AccountDataFacade["listFriendRequests"]>) {
    return this.accountData.listFriendRequests(...args)
  }

  mutateFriendRequest(...args: Parameters<AccountDataFacade["mutateFriendRequest"]>) {
    return this.accountData.mutateFriendRequest(...args)
  }

  deleteFriend(...args: Parameters<AccountDataFacade["deleteFriend"]>) {
    return this.accountData.deleteFriend(...args)
  }

  openContactConversation(...args: Parameters<AccountDataFacade["openContactConversation"]>) {
    return this.accountData.openContactConversation(...args)
  }

  createClientApp(...args: Parameters<AccountDataFacade["createClientApp"]>) {
    return this.accountData.createClientApp(...args)
  }

  getClientApp(...args: Parameters<AccountDataFacade["getClientApp"]>) {
    return this.accountData.getClientApp(...args)
  }

  updateClientApp(...args: Parameters<AccountDataFacade["updateClientApp"]>) {
    return this.accountData.updateClientApp(...args)
  }

  deleteClientApp(...args: Parameters<AccountDataFacade["deleteClientApp"]>) {
    return this.accountData.deleteClientApp(...args)
  }

  regenerateClientAppSecret(...args: Parameters<AccountDataFacade["regenerateClientAppSecret"]>) {
    return this.accountData.regenerateClientAppSecret(...args)
  }

  uploadClientAppAvatar(...args: Parameters<AccountDataFacade["uploadClientAppAvatar"]>) {
    return this.accountData.uploadClientAppAvatar(...args)
  }

  getAvatar(...args: Parameters<AccountDataFacade["getAvatar"]>) {
    return this.accountData.getAvatar(...args)
  }

  invalidateAvatar(...args: Parameters<AccountDataFacade["invalidateAvatar"]>) {
    return this.accountData.invalidateAvatar(...args)
  }

  readAvatarResource(...args: Parameters<AccountDataFacade["readAvatarResource"]>) {
    return this.accountData.readAvatarResource(...args)
  }

  getAvatarResourceFilePath(...args: Parameters<AccountDataFacade["getAvatarResourceFilePath"]>) {
    return this.accountData.getAvatarResourceFilePath(...args)
  }

  close() {
    this.destroyAccountRuntime()
  }

  setTheme(theme: ThemePreference): Promise<null> {
    return this.exclusive(() => this.settings.setTheme(theme))
  }

  setNotificationSettings(settings: NotificationSettings): Promise<null> {
    return this.exclusive(() => this.settings.setNotifications(settings))
  }

  setShortcutSettings(shortcuts: ShortcutSettings): Promise<null> {
    return this.exclusive(() => this.settings.setShortcuts(shortcuts))
  }

  saveServer(input: SaveServerInput): Promise<{ catalog: ServerCatalog; check: ServerCheck }> {
    return this.exclusive(() => this.servers.save(input))
  }

  deleteServer(id: string): Promise<ServerCatalog> {
    return this.exclusive(() => this.servers.delete(id))
  }

  async checkServer(id: string): Promise<ServerCheck> {
    await this.initialized
    return this.servers.inspect(this.servers.getProfile(id))
  }

  async checkServers(): Promise<ServerCheck[]> {
    await this.initialized
    return Promise.all(this.config.servers.map((item) => this.servers.inspect(item)))
  }

  connect(serverId: string): Promise<Connection> {
    return this.exclusive(async () => {
      const profile = this.servers.getProfile(serverId)
      const server = normalizeServer(profile)
      // 即使地址只差端口或部署路径，也使用独立网络会话隔离服务器状态。
      const serverSession = this.servers.createSession(server.url)
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
        savedLogin: readSavedLogin(this.config.serverLogins[profile.id]),
      }
      const config = { ...this.config, activeServerId: profile.id }
      await this.configStore.save(config)
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
        const encryptedPassword = encryptPassword(input.secret)
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
        await this.configStore.save(config)
        this.config = config
        active.savedLogin = readSavedLogin(this.config.serverLogins[active.server.id])
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

      await clearServerAuthCookies(active.session, active.server.url)
      let credential: NativeSessionCredential | null = null
      try {
        credential = await openThirdPartyLoginWindow({
          serverSession: active.session,
          serverUrl: active.server.url,
          provider,
          parent,
        })
        const user = parseUser(
          await request(active.session, active.server.url, "/api/client/me", undefined, 15_000, {
            headers: { Authorization: `Bearer ${credential.token}` },
            omitOrigin: true,
            credentials: "omit",
          }),
        )
        active.credential = credential
        active.user = user
        await clearServerAuthCookies(active.session, active.server.url)
        try {
          const config = this.withRememberedAccount(this.config, active)
          await this.configStore.save(config)
          this.config = config
        } catch {
          // Token 记忆失败不影响已建立的认证会话。
        }
        this.createAccountRuntime(active)
        return { user }
      } catch (error) {
        active.credential = null
        if (credential) await this.revokeCredential(active, credential)
        await clearServerAuthCookies(active.session, active.server.url)
        throw error
      }
    })
  }

  signOut(targetId: string): Promise<null> {
    return this.exclusive(async () => {
      const active = this.requireTarget(targetId)
      const accountKey = active.user ? createAccountKey(active.server.url, active.user.id) : null
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

  private async revokeCredential(active: ActiveConnection, credential: NativeSessionCredential) {
    await request(active.session, active.server.url, "/api/client/auth/logout", {}, 15_000, {
      headers: { Authorization: `Bearer ${credential.token}` },
      omitOrigin: true,
      credentials: "omit",
    }).catch(() => undefined)
  }

  private async initializeAccountRuntime(
    active: ActiveConnection,
    runtime: AccountRuntime,
    operation: () => Promise<void> = () => runtime.initialize(),
  ) {
    try {
      await operation()
      return null
    } catch (error) {
      if (this.accountRuntime === runtime) {
        const credential = active.credential
        const accountKey = active.user ? createAccountKey(active.server.url, active.user.id) : null
        this.destroyAccountRuntime()
        active.user = null
        active.credential = null
        if (credential) {
          await Promise.allSettled([
            this.revokeCredential(active, credential),
            clearServerAuthCookies(active.session, active.server.url),
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
      onConversationPresenceChanged: this.accountEvents.onConversationPresenceChanged,
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

  private withRememberedAccount(config: AppConfig, active: ActiveConnection): AppConfig {
    if (!active.user || !active.credential) return config
    const key = createAccountKey(active.server.url, active.user.id)
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
    await this.configStore.save(config)
    this.config = config
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
