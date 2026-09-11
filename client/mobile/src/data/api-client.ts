const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const PUBLIC_CLIENT_PATHS = new Set([
  "/api/client/info",
  "/api/client/auth/email-code/login",
  "/api/client/auth/email-code/request",
  "/api/client/auth/login",
  "/api/client/auth/logout",
])

export type ApiFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>

export type AccountAuthSnapshot = Readonly<{
  accountId: string
  generation: number
  token: string
}>

export type AuthResolver = () => Promise<AccountAuthSnapshot>

export type ApiClientAuthOptions = {
  auth: AuthResolver
  isCurrent: (snapshot: AccountAuthSnapshot) => boolean | Promise<boolean>
  onUnauthorized?: (accountId: string, error: AccountUnauthorizedError) => void | Promise<void>
}

export type ApiClientOptions = {
  auth?: ApiClientAuthOptions
}

type ApiErrorEnvelope = {
  error?: { code?: string; message?: string }
  success?: boolean
}

type ApiSuccessEnvelope<T> = { data?: T; success?: boolean }

type ApiRequestOptions = Omit<RequestInit, "credentials"> & {
  errorMessage: string
  /** 401 business codes which do not invalidate the authenticated Session. */
  nonSessionUnauthorizedCodes?: readonly string[]
  timeoutMs?: number
}

export class ApiRequestError extends Error {
  code?: string
  kind?: "connection"
  status?: number

  constructor(message: string, options: { code?: string; kind?: "connection"; status?: number } = {}) {
    super(redactAuthorization(message))
    this.name = "ApiRequestError"
    this.code = options.code
    this.kind = options.kind
    this.status = options.status
  }
}

export class StaleAccountOperationError extends Error {
  readonly accountId: string
  constructor(accountId: string) {
    super("账号已切换，已丢弃过期请求结果")
    this.name = "StaleAccountOperationError"
    this.accountId = accountId
  }
}

export class AccountUnauthorizedError extends ApiRequestError {
  readonly accountId: string
  constructor(accountId: string, options: { code?: string; message?: string } = {}) {
    super(options.message ?? "账号登录状态已失效，请重新登录", { code: options.code, status: 401 })
    this.name = "AccountUnauthorizedError"
    this.accountId = accountId
  }
}

export function createApiClient(
  serverUrl: string,
  fetcher: ApiFetch = fetch,
  clientOptions: ApiClientOptions = {}
) {
  const baseUrl = `${serverUrl.replace(/\/+$/, "")}/`

  return {
    async request<T>(path: string, options: ApiRequestOptions) {
      const {
        errorMessage,
        nonSessionUnauthorizedCodes = [],
        signal: parentSignal,
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
        ...requestInit
      } = options
      const controller = new AbortController()
      let didTimeout = false
      let snapshot: AccountAuthSnapshot | undefined
      let rejectParentAbort: ((error: Error) => void) | undefined
      const parentAbortFailure = new Promise<never>((_, reject) => {
        rejectParentAbort = reject
      })
      const handleParentAbort = () => {
        controller.abort()
        rejectParentAbort?.(createAbortError())
      }
      if (parentSignal?.aborted) handleParentAbort()
      else {
        parentSignal?.addEventListener("abort", handleParentAbort, {
          once: true,
        })
      }

      let timeout: ReturnType<typeof setTimeout> | undefined
      const timeoutFailure = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          didTimeout = true
          reject(
            new ApiRequestError(`${errorMessage}：请求超时`, {
              kind: "connection",
            })
          )
          controller.abort()
        }, timeoutMs)
      })

      const assertCurrent = async () => {
        if (snapshot && !(await clientOptions.auth!.isCurrent(snapshot))) {
          throw new StaleAccountOperationError(snapshot.accountId)
        }
      }

      const requestResult = (async () => {
        const endpoint = new URL(
          path.replace(/^\/+/, ""),
          baseUrl
        ).toString()
        assertPublicClientBoundary(endpoint, Boolean(clientOptions.auth))
        const callerHeaders = new Headers(requestInit.headers)
        if (clientOptions.auth && callerHeaders.has("authorization")) {
          throw new ApiRequestError(
            "受保护请求的 Authorization 由账号认证边界管理，调用者不能覆盖"
          )
        }
        if (clientOptions.auth) {
          const resolved = await clientOptions.auth.auth()
          snapshot = Object.freeze({ ...resolved })
          if (
            !snapshot.accountId ||
            !Number.isFinite(snapshot.generation) ||
            !snapshot.token
          ) {
            throw new ApiRequestError("账号认证凭据不可用，请重新登录")
          }
          callerHeaders.set("Authorization", `Bearer ${snapshot.token}`)
        }

        const response = await fetcher(endpoint, {
          ...requestInit,
          headers: callerHeaders,
          credentials: "include",
          signal: controller.signal,
        })
        await assertCurrent()
        const payload = await readJson<
          ApiErrorEnvelope | ApiSuccessEnvelope<T>
        >(response)
        await assertCurrent()

        if (!response.ok || payload?.success === false) {
          const error = (payload as ApiErrorEnvelope | undefined)?.error
          if (response.status === 401 && snapshot && !nonSessionUnauthorizedCodes.includes(error?.code ?? "")) {
            const unauthorized = new AccountUnauthorizedError(
              snapshot.accountId,
              { code: error?.code }
            )
            await clientOptions.auth?.onUnauthorized?.(
              snapshot.accountId,
              unauthorized
            )
            throw unauthorized
          }
          throw new ApiRequestError(
            redactSecret(error?.message, snapshot?.token) ??
              `${errorMessage}（HTTP ${response.status}）`,
            {
              code: error?.code,
              status: response.status,
            }
          )
        }
        return (payload as ApiSuccessEnvelope<T> | undefined)?.data
      })()

      try {
        return await Promise.race([
          requestResult,
          timeoutFailure,
          parentAbortFailure,
        ])
      } catch (error: unknown) {
        if (
          error instanceof ApiRequestError ||
          error instanceof StaleAccountOperationError ||
          parentSignal?.aborted
        ) {
          throw error
        }
        if (didTimeout) {
          throw new ApiRequestError(`${errorMessage}：请求超时`, {
            kind: "connection",
          })
        }
        throw new ApiRequestError(`${errorMessage}：无法连接到服务器`, {
          kind: "connection",
        })
      } finally {
        clearTimeout(timeout)
        parentSignal?.removeEventListener("abort", handleParentAbort)
      }
    },
  }
}

function assertPublicClientBoundary(endpoint: string, authenticated: boolean) {
  if (authenticated) return
  const pathname = new URL(endpoint).pathname.replace(/\/+$/, "") || "/"
  if (
    pathname.startsWith("/api/client/") &&
    !PUBLIC_CLIENT_PATHS.has(pathname)
  ) {
    throw new ApiRequestError(
      "受保护的客户端接口必须使用显式账号认证目标"
    )
  }
}

function createAbortError() {
  const error = new Error("请求已取消")
  error.name = "AbortError"
  return error
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 401 || error.code === "unauthorized")
}

export function isConnectionError(error: unknown) {
  return error instanceof ApiRequestError && error.kind === "connection"
}

function redactAuthorization(value: string) {
  return value.replace(/authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, "Authorization: [REDACTED]")
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
}

function redactSecret(value: string | undefined, secret: string | undefined) {
  if (!value) return undefined
  const withoutSecret = secret ? value.split(secret).join("[REDACTED]") : value
  return redactAuthorization(withoutSecret)
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiRequestError("服务器响应格式不正确", { status: response.status })
  }
}
