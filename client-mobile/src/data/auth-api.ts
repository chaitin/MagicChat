import { ApiRequestError, createApiClient, type ApiFetch } from "@/data/api-client"
import type { AuthenticatedUser } from "@/data/models"

type LoginResponse = {
  user?: {
    email?: string
    id?: string
    name?: string
  }
}

type EmailCodeRequestResponse = {
  expires_in_seconds?: number
  retry_after_seconds?: number
}

export type EmailCodeRequestResult = {
  expiresInSeconds: number
  retryAfterSeconds: number
}

export async function login(
  serverUrl: string,
  input: { account: string; password: string },
  options: { fetcher?: ApiFetch } = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
    LoginResponse
  >("/api/client/auth/login", {
    body: JSON.stringify({
      email: input.account.trim(),
      password: input.password,
    }),
    errorMessage: "登录失败",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  return normalizeAuthenticatedUser(data)
}

export async function requestEmailLoginCode(
  serverUrl: string,
  email: string,
  options: { fetcher?: ApiFetch } = {}
): Promise<EmailCodeRequestResult> {
  const data = await createApiClient(serverUrl, options.fetcher).request<
    EmailCodeRequestResponse
  >("/api/client/auth/email-code/request", {
    body: JSON.stringify({ email: email.trim() }),
    errorMessage: "验证码发送失败",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const expiresInSeconds = data?.expires_in_seconds
  const retryAfterSeconds = data?.retry_after_seconds

  if (
    typeof expiresInSeconds !== "number" ||
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    typeof retryAfterSeconds !== "number" ||
    !Number.isFinite(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    throw new ApiRequestError("验证码发送响应格式不正确")
  }

  return {
    expiresInSeconds,
    retryAfterSeconds,
  }
}

export async function loginWithEmailCode(
  serverUrl: string,
  input: { code: string; email: string },
  options: { fetcher?: ApiFetch } = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
    LoginResponse
  >("/api/client/auth/email-code/login", {
    body: JSON.stringify({
      code: input.code,
      email: input.email.trim(),
    }),
    errorMessage: "登录失败",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  return normalizeAuthenticatedUser(data)
}

export async function logout(
  serverUrl: string,
  options: { fetcher?: ApiFetch } = {}
) {
  await createApiClient(serverUrl, options.fetcher).request<void>(
    "/api/client/auth/logout",
    {
      errorMessage: "退出登录失败",
      method: "POST",
    }
  )
}

function normalizeAuthenticatedUser(data: LoginResponse | undefined) {
  const user = data?.user

  if (!user?.email || !user.id || !user.name) {
    throw new ApiRequestError("登录响应格式不正确")
  }

  return {
    email: user.email,
    id: user.id,
    name: user.name,
  } satisfies AuthenticatedUser
}
