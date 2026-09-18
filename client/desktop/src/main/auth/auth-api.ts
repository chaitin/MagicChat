import type { Session } from "electron"
import {
  AuthFailure,
  isRecord,
  type AppInfo,
  type AuthUser,
  type ThirdPartyProvider,
} from "../../shared/auth"

export type NativeSessionCredential = { token: string; expiresAt: string }

type RequestOptions = {
  headers?: Record<string, string>
  omitOrigin?: boolean
  credentials?: "include" | "omit"
}

const maxResponseBytes = 128 * 1024

export async function request(
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
    if (response.status === 401) {
      throw new AuthFailure(
        "unauthorized",
        endpoint === "/api/client/auth/login"
          ? "账号或密码错误"
          : endpoint.endsWith("email-code/login")
            ? "验证码无效或已过期"
            : "登录已失效，请重新登录",
      )
    }
    const reader = response.body?.getReader()
    if (!reader) throw invalidResponse()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxResponseBytes) throw invalidResponse()
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
    if (error instanceof Error && /certificate|tls|ssl/i.test(error.message)) {
      throw new AuthFailure("tls", "服务器证书验证失败，请联系管理员检查 HTTPS 配置")
    }
    throw new AuthFailure("network", "无法连接服务器，请检查地址、网络和 HTTPS 配置")
  }
}

export function parseAppInfo(data: unknown): AppInfo {
  if (!isRecord(data) || !validText(data.app_name) || !validText(data.organization_name)) {
    throw invalidResponse()
  }
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

export function parseNativeSession(data: unknown): {
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

export function parseUser(data: unknown): AuthUser {
  if (
    !isRecord(data) ||
    !isRecord(data.user) ||
    !validText(data.user.id) ||
    !validText(data.user.email) ||
    !validText(data.user.name)
  ) {
    throw invalidResponse()
  }
  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name,
    avatar: typeof data.user.avatar === "string" ? data.user.avatar : "",
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

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 300
}

export function validSeconds(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 86_400
}

export function invalidResponse() {
  return new AuthFailure("invalid_response", "服务器返回的数据格式不正确，请确认这是即应服务器")
}
