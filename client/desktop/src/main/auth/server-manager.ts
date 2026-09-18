import { createHash, randomUUID } from "node:crypto"
import { session, type Session } from "electron"
import {
  AuthFailure,
  normalizeServer,
  normalizeServerName,
  type SaveServerInput,
  type ServerCatalog,
  type ServerCheck,
  type ServerProfile,
} from "../../shared/auth"
import { AppConfigStore, MAX_SERVERS, type AppConfig } from "./app-config-store"
import { parseAppInfo, request } from "./auth-api"

export class ServerManager {
  constructor(
    private readonly configStore: AppConfigStore,
    private readonly getConfig: () => AppConfig,
    private readonly setConfig: (config: AppConfig) => void,
    private readonly updateActiveServer: (profile: ServerProfile) => void,
  ) {}

  catalog(): ServerCatalog {
    const config = this.getConfig()
    return {
      activeServerId: config.activeServerId,
      servers: config.servers.map((item) => ({ ...item })),
    }
  }

  activeProfile() {
    return { ...this.getProfile(this.getConfig().activeServerId) }
  }

  getProfile(id: unknown): ServerProfile {
    if (typeof id !== "string") throw new AuthFailure("invalid_server", "服务器不存在")
    const profile = this.getConfig().servers.find((item) => item.id === id)
    if (!profile) throw new AuthFailure("invalid_server", "服务器不存在或已被删除")
    return profile
  }

  createSession(serverUrl: string): Session {
    const partition = `persist:jiying-auth-${createHash("sha256").update(serverUrl).digest("hex")}`
    const serverSession = session.fromPartition(partition)
    serverSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    serverSession.setPermissionCheckHandler(() => false)
    return serverSession
  }

  async save(input: SaveServerInput): Promise<{ catalog: ServerCatalog; check: ServerCheck }> {
    const current = this.getConfig()
    const name = normalizeServerName(input?.name)
    const server = normalizeServer(input)
    const existing = input.id ? this.getProfile(input.id) : undefined
    if (existing?.builtin) throw new AuthFailure("builtin_server", "官方服务器不能修改")
    if (!existing && current.servers.length >= MAX_SERVERS) {
      throw new AuthFailure("server_limit", `最多保存 ${MAX_SERVERS} 个服务器`)
    }
    if (
      current.servers.some(
        (item) => item.url === server.url && (!existing || item.id !== existing.id),
      )
    ) {
      throw new AuthFailure("duplicate_server", "该服务器地址已存在")
    }
    if (existing && existing.id === current.activeServerId && existing.url !== server.url) {
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
      ? current.servers.map((item) => (item.id === existing.id ? profile : item))
      : [...current.servers, profile]
    const serverLogins = { ...current.serverLogins }
    const accountSessions = { ...current.accountSessions }
    if (existing && existing.url !== profile.url) {
      delete serverLogins[existing.id]
      for (const [key, account] of Object.entries(accountSessions)) {
        if (account.serverId === existing.id) delete accountSessions[key]
      }
    }
    const lastAccountKey =
      current.lastAccountKey && accountSessions[current.lastAccountKey]
        ? current.lastAccountKey
        : null
    const config = { ...current, servers, serverLogins, accountSessions, lastAccountKey }
    await this.configStore.save(config)
    this.setConfig(config)
    this.updateActiveServer(profile)
    return { catalog: this.catalog(), check: await this.inspect(profile) }
  }

  async delete(id: string): Promise<ServerCatalog> {
    const current = this.getConfig()
    const profile = this.getProfile(id)
    if (profile.builtin) throw new AuthFailure("builtin_server", "官方服务器不能删除")
    if (profile.id === current.activeServerId) {
      throw new AuthFailure("active_server", "请先返回服务器选择页并切换服务器，再删除当前服务器")
    }
    const serverLogins = { ...current.serverLogins }
    delete serverLogins[profile.id]
    const accountSessions = Object.fromEntries(
      Object.entries(current.accountSessions).filter(
        ([, account]) => account.serverId !== profile.id,
      ),
    )
    const lastAccountKey =
      current.lastAccountKey && accountSessions[current.lastAccountKey]
        ? current.lastAccountKey
        : null
    const config = {
      ...current,
      servers: current.servers.filter((item) => item.id !== profile.id),
      serverLogins,
      accountSessions,
      lastAccountKey,
    }
    await this.configStore.save(config)
    this.setConfig(config)
    return this.catalog()
  }

  async inspect(profile: ServerProfile): Promise<ServerCheck> {
    const checkedAt = Date.now()
    try {
      const data = await request(
        this.createSession(profile.url),
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
}
