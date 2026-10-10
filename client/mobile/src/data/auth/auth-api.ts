import {
  ApiRequestError,
  createApiClient,
  type ApiFetch,
} from "@/data/api-client"
import type { AuthenticatedUser } from "@/core/models"

export const MOBILE_SESSION_HEADER = "X-Dianbao-Mobile-Session"
export const MOBILE_SESSION_VERSION = "2"

export type MobileSessionCredential = Readonly<{
  token: string; expiresAt: string; refreshToken: string
  refreshExpiresAt: string; refreshAbsoluteExpiresAt: string
}>

type LoginResponse = {
  mobile_session?: { token?: unknown; expires_at?: unknown; refresh_token?: unknown; refresh_expires_at?: unknown; refresh_absolute_expires_at?: unknown }
  user?: { avatar?: unknown; email?: unknown; id?: unknown; name?: unknown }
}

type EmailCodeRequestResponse = {
  expires_in_seconds?: number
  retry_after_seconds?: number
}

export type EmailCodeRequestResult = { expiresInSeconds: number; retryAfterSeconds: number }

type LoginOptions = {
  fetcher?: ApiFetch
  /** 在认证边界立即接收敏感凭据；login 的返回值仍仅包含非敏感 user。 */
  onMobileSession?: (credential: MobileSessionCredential) => void | Promise<void>
}

export class MobileSessionCompatibilityError extends ApiRequestError {
  constructor(reason: "missing" | "invalid" | "expired") {
    const action = reason === "expired" ? "服务器返回的会话已过期，请重试登录或联系管理员" : "服务器不支持安全的 Mobile 登录会话，请升级服务器后重试"
    super(action, { code: `mobile_session_${reason}` })
    this.name = "MobileSessionCompatibilityError"
  }
}

export async function login(serverUrl: string, input: { account: string; password: string }, options: LoginOptions = {}) {
  const data = await createApiClient(serverUrl, options.fetcher).request<LoginResponse>("/api/client/auth/login", {
    body: JSON.stringify({ email: input.account.trim(), password: input.password }),
    errorMessage: "登录失败",
    headers: { "Content-Type": "application/json", [MOBILE_SESSION_HEADER]: MOBILE_SESSION_VERSION },
    method: "POST",
  })
  return consumeLoginResponse(serverUrl, data, options)
}

export async function requestEmailLoginCode(serverUrl: string, email: string, options: { fetcher?: ApiFetch } = {}): Promise<EmailCodeRequestResult> {
  const data = await createApiClient(serverUrl, options.fetcher).request<EmailCodeRequestResponse>("/api/client/auth/email-code/request", {
    body: JSON.stringify({ email: email.trim() }),
    errorMessage: "验证码发送失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const expiresInSeconds = data?.expires_in_seconds
  const retryAfterSeconds = data?.retry_after_seconds
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    throw new ApiRequestError("验证码发送响应格式不正确")
  }
  return { expiresInSeconds, retryAfterSeconds }
}

export async function loginWithEmailCode(serverUrl: string, input: { code: string; email: string }, options: LoginOptions = {}) {
  const data = await createApiClient(serverUrl, options.fetcher).request<LoginResponse>("/api/client/auth/email-code/login", {
    body: JSON.stringify({ code: input.code, email: input.email.trim() }),
    errorMessage: "登录失败",
    headers: { "Content-Type": "application/json", [MOBILE_SESSION_HEADER]: MOBILE_SESSION_VERSION },
    method: "POST",
  })
  return consumeLoginResponse(serverUrl, data, options)
}

type AccountLogoutOptions = {
  account: { accountId: string; refreshToken: string }
  fetcher?: ApiFetch
}

export async function logout(
  serverUrl: string,
  options: AccountLogoutOptions
) {
  if (!options.account.accountId) {
    throw new ApiRequestError("必须指定待登出的账号")
  }
  if (!options.account.refreshToken) throw new ApiRequestError("登出凭据不可用")
  try {
    await createApiClient(serverUrl, options.fetcher).request<void>("/api/client/auth/native/revoke", {
      body: JSON.stringify({ refresh_token: options.account.refreshToken }),
      errorMessage: "退出登录失败",
      headers: { "Content-Type": "application/json", [MOBILE_SESSION_HEADER]: MOBILE_SESSION_VERSION },
      method: "POST",
    })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return
    throw error
  }
}

export async function refreshNativeSession(serverUrl: string, refreshToken: string, fetcher?: ApiFetch): Promise<MobileSessionCredential> {
  const data = await createApiClient(serverUrl, fetcher).request<{ token?: unknown; expires_at?: unknown; refresh_token?: unknown; refresh_expires_at?: unknown; refresh_absolute_expires_at?: unknown }>("/api/client/auth/native/refresh", {
    body: JSON.stringify({ refresh_token: refreshToken }),
    errorMessage: "续期失败",
    headers: { "Content-Type": "application/json", [MOBILE_SESSION_HEADER]: MOBILE_SESSION_VERSION },
    method: "POST",
  })
  return parseMobileCredential(data)
}

async function consumeLoginResponse(
  serverUrl: string,
  data: LoginResponse | undefined,
  options: LoginOptions
): Promise<AuthenticatedUser> {
  const { credential, user } = normalizeLoginResponse(data)
  if (!options.onMobileSession) return user
  try {
    await options.onMobileSession(credential)
    return user
  } catch (error) {
    const accountId = `pending-login:${user.id}`
    await logout(serverUrl, {
      account: {
        accountId,
        refreshToken: credential.refreshToken,
      },
      fetcher: options.fetcher,
    }).catch(() => undefined)
    throw error
  }
}

function parseMobileCredential(data: LoginResponse["mobile_session"]): MobileSessionCredential {
  const token = data?.token
  const expiresAt = data?.expires_at
  const refreshToken = data?.refresh_token
  const refreshExpiresAt = data?.refresh_expires_at
  const refreshAbsoluteExpiresAt = data?.refresh_absolute_expires_at
  if (typeof token !== "string" || !token || typeof refreshToken !== "string" || !refreshToken ||
    typeof expiresAt !== "string" || typeof refreshExpiresAt !== "string" || typeof refreshAbsoluteExpiresAt !== "string") {
    throw new MobileSessionCompatibilityError("invalid")
  }
  const times = [expiresAt, refreshExpiresAt, refreshAbsoluteExpiresAt].map(Date.parse)
  if (times.some((time) => !Number.isFinite(time))) throw new MobileSessionCompatibilityError("invalid")
  if (times.some((time) => time <= Date.now())) throw new MobileSessionCompatibilityError("expired")
  return Object.freeze({ token, expiresAt, refreshToken, refreshExpiresAt, refreshAbsoluteExpiresAt })
}

function normalizeLoginResponse(data: LoginResponse | undefined): {
  credential: MobileSessionCredential
  user: AuthenticatedUser
} {
  const user = data?.user
  if (
    typeof user?.email !== "string" ||
    !user.email ||
    typeof user.id !== "string" ||
    !user.id ||
    typeof user.name !== "string" ||
    !user.name
  ) {
    throw new MobileSessionCompatibilityError("invalid")
  }
  if (!data?.mobile_session) {
    throw new MobileSessionCompatibilityError("missing")
  }
  return {
    credential: parseMobileCredential(data.mobile_session),
    user: {
      avatar: typeof user.avatar === "string" ? user.avatar : "",
      email: user.email,
      id: user.id,
      name: user.name,
    },
  }
}
