export const OFFICIAL_SERVER_URL = "https://app.jiying.chat"
export const OFFICIAL_SERVER_ID = "official"
export const AUTH_CHANNELS = {
  getServer: "desktop-next:v1:auth-server",
  getServers: "desktop-next:v1:auth-servers",
  saveServer: "desktop-next:v1:auth-save-server",
  deleteServer: "desktop-next:v1:auth-delete-server",
  checkServer: "desktop-next:v1:auth-check-server",
  checkServers: "desktop-next:v1:auth-check-servers",
  connect: "desktop-next:v1:auth-connect",
  signIn: "desktop-next:v1:auth-sign-in",
  signInThirdParty: "desktop-next:v1:auth-sign-in-third-party",
  sendCode: "desktop-next:v1:auth-send-code",
  signOut: "desktop-next:v1:auth-sign-out",
} as const

export type LoginMethod = "email-code" | "password"
export type ServerPreference = { url: string; allowInsecureHttp: boolean }
export type ServerProfile = ServerPreference & {
  id: string
  name: string
  builtin: boolean
}
export type ServerCatalog = { activeServerId: string; servers: ServerProfile[] }
export type SaveServerInput = {
  id?: string
  name: string
  url: string
  allowInsecureHttp: boolean
}
export type ServerCheck = {
  serverId: string
  status: "available" | "unavailable"
  checkedAt: number
  organizationName?: string
  message?: string
}
export type AuthUser = { id: string; email: string; name: string }
export type ThirdPartyProvider = { key: string; name: string }
export type AppInfo = {
  appName: string
  organizationName: string
  emailCodeLoginEnabled: boolean
  passwordLoginEnabled: boolean
  thirdPartyProviders: ThirdPartyProvider[]
}
export type Connection = {
  targetId: string
  server: ServerProfile
  info: AppInfo
  user: AuthUser | null
  lastEmail: string
}
export type AuthProblem = { code: string; message: string; retryAfterSeconds?: number }
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthProblem }
export type SignInInput = {
  targetId: string
  method: LoginMethod
  email: string
  secret: string
}
export type CodeResult = { expiresInSeconds: number; retryAfterSeconds: number }
export type SignInResult = { user: AuthUser; warning?: string }
export type ThirdPartySignInInput = { targetId: string; providerKey: string }

export interface AuthBridge {
  getServer(): Promise<AuthResult<ServerProfile>>
  getServers(): Promise<AuthResult<ServerCatalog>>
  saveServer(
    input: SaveServerInput,
  ): Promise<AuthResult<{ catalog: ServerCatalog; check: ServerCheck }>>
  deleteServer(id: string): Promise<AuthResult<ServerCatalog>>
  checkServer(id: string): Promise<AuthResult<ServerCheck>>
  checkServers(): Promise<AuthResult<ServerCheck[]>>
  connect(serverId: string): Promise<AuthResult<Connection>>
  signIn(input: SignInInput): Promise<AuthResult<SignInResult>>
  signInThirdParty(input: ThirdPartySignInInput): Promise<AuthResult<SignInResult>>
  sendCode(input: { targetId: string; email: string }): Promise<AuthResult<CodeResult>>
  signOut(targetId: string): Promise<AuthResult<{ localOnly: boolean }>>
}

export class AuthFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

export function normalizeServerName(value: unknown): string {
  if (typeof value !== "string") throw new AuthFailure("invalid_server_name", "请输入服务器名称")
  const name = value.trim()
  if (!name || name.length > 64)
    throw new AuthFailure("invalid_server_name", "服务器名称应为 1 至 64 个字符")
  return name
}

export function normalizeServer(input: ServerPreference): ServerPreference {
  if (!input || typeof input.url !== "string" || input.url.length > 2048) {
    throw new AuthFailure("invalid_server", "请输入有效的服务器地址")
  }
  const value = input.url.trim()
  if (!value) throw new AuthFailure("invalid_server", "请输入服务器地址")
  let url: URL
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`)
  } catch {
    throw new AuthFailure("invalid_server", "服务器地址格式不正确")
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AuthFailure(
      "invalid_server",
      "请填写 HTTP(S) 服务器地址，不要包含账号、查询参数或锚点",
    )
  }
  if (url.protocol === "http:" && input.allowInsecureHttp !== true) {
    throw new AuthFailure(
      "insecure_server",
      "HTTP 会明文传输登录信息，请优先使用 HTTPS；继续前需确认风险",
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"
  return { url: url.toString().replace(/\/$/, ""), allowInsecureHttp: url.protocol === "http:" }
}

export function resolveLoginMethod(info: AppInfo, preferred: LoginMethod): LoginMethod | null {
  if (info.emailCodeLoginEnabled && info.passwordLoginEnabled) return preferred
  if (info.emailCodeLoginEnabled) return "email-code"
  return info.passwordLoginEnabled ? "password" : null
}

export function normalizeEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    throw new AuthFailure("invalid_email", "请输入有效的邮箱地址")
  }
  return value.trim()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
