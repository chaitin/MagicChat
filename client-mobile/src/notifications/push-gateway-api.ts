import type { ApiFetch } from "@/data/api-client"
import {
  PUSH_GATEWAY_URL,
  type PushEnvironment,
  type PushPlatform,
  type PushProviderName,
} from "@/notifications/push-types"

const PUSH_REQUEST_TIMEOUT_MS = 5_000

type GatewayErrorEnvelope = {
  error?: { code?: string; message?: string }
  success?: boolean
}

export class PushGatewayRequestError extends Error {
  code?: string
  status?: number

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message)
    this.name = "PushGatewayRequestError"
    this.code = options.code
    this.status = options.status
  }
}

export async function registerPushInstallation(
  input: {
    appVersion: string
    environment: PushEnvironment
    platform: PushPlatform
    provider: PushProviderName
    providerToken: string
  },
  options: { fetcher?: ApiFetch } = {}
) {
  const value = await gatewayRequest<unknown>("/api/v1/installations", {
    body: JSON.stringify({
      app_version: input.appVersion,
      environment: input.environment,
      platform: input.platform,
      provider: input.provider,
      provider_token: input.providerToken,
    }),
    fetcher: options.fetcher,
    method: "POST",
  })
  if (
    !isRecord(value) ||
    typeof value.installation_id !== "string" ||
    !value.installation_id ||
    typeof value.management_token !== "string" ||
    !value.management_token
  ) {
    throw new PushGatewayRequestError("推送安装注册响应格式不正确")
  }
  return {
    installationId: value.installation_id,
    managementToken: value.management_token,
  }
}

export async function updatePushProviderToken(
  installationId: string,
  managementToken: string,
  input: { appVersion: string; providerToken: string },
  options: { fetcher?: ApiFetch } = {}
) {
  await gatewayRequest(
    `/api/v1/installations/${encodeURIComponent(installationId)}/provider-token`,
    {
      authorization: `Installation ${managementToken}`,
      body: JSON.stringify({
        app_version: input.appVersion,
        provider_token: input.providerToken,
      }),
      fetcher: options.fetcher,
      method: "PUT",
    }
  )
}

export async function createActivePushGrant(
  installationId: string,
  managementToken: string,
  options: { fetcher?: ApiFetch } = {}
) {
  const value = await gatewayRequest<unknown>(
    `/api/v1/installations/${encodeURIComponent(installationId)}/active-grant`,
    {
      authorization: `Installation ${managementToken}`,
      fetcher: options.fetcher,
      method: "POST",
    }
  )
  return normalizeGrantCredential(value)
}

export async function renewPushGrant(
  grantId: string,
  managementToken: string,
  options: { fetcher?: ApiFetch } = {}
) {
  const value = await gatewayRequest<unknown>(
    `/api/v1/grants/${encodeURIComponent(grantId)}/renew`,
    {
      authorization: `Installation ${managementToken}`,
      fetcher: options.fetcher,
      method: "POST",
    }
  )
  if (
    !isRecord(value) ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new PushGatewayRequestError("推送授权续期响应格式不正确")
  }
  return { expiresAt: value.expires_at }
}

export async function revokePushGrant(
  grantId: string,
  managementToken: string,
  options: { fetcher?: ApiFetch } = {}
) {
  await gatewayRequest(`/api/v1/grants/${encodeURIComponent(grantId)}`, {
    authorization: `Installation ${managementToken}`,
    fetcher: options.fetcher,
    method: "DELETE",
  })
}

export function pushGatewayCredentialIsInvalid(error: unknown) {
  return (
    error instanceof PushGatewayRequestError &&
    (error.status === 401 || error.status === 404 || error.status === 410)
  )
}

export function pushGatewayInstallationIsDisabled(error: unknown) {
  return (
    error instanceof PushGatewayRequestError &&
    error.status === 410 &&
    error.code === "installation_disabled"
  )
}

async function gatewayRequest<T = unknown>(
  path: string,
  options: {
    authorization?: string
    body?: string
    fetcher?: ApiFetch
    method: string
  }
): Promise<T | undefined> {
  const controller = new AbortController()
  const fetcher = options.fetcher ?? fetch
  let didTimeout = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
      reject(new PushGatewayRequestError("推送网关请求超时"))
    }, PUSH_REQUEST_TIMEOUT_MS)
  })
  const requestResult = (async () => {
    const response = await fetcher(`${PUSH_GATEWAY_URL}${path}`, {
      body: options.body,
      headers: {
        ...(options.authorization
          ? { Authorization: options.authorization }
          : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      method: options.method,
      signal: controller.signal,
    })
    const payload = await readGatewayJSON(response)
    if (!response.ok) {
      const failure = isRecord(payload) ? payload.error : undefined
      const error = isRecord(failure) ? failure : undefined
      throw new PushGatewayRequestError(
        typeof error?.message === "string"
          ? error.message
          : `推送网关请求失败（HTTP ${response.status}）`,
        {
          code: typeof error?.code === "string" ? error.code : undefined,
          status: response.status,
        }
      )
    }
    if (response.status === 204) return undefined
    if (
      !isRecord(payload) ||
      payload.success !== true ||
      !("data" in payload)
    ) {
      throw new PushGatewayRequestError("推送网关响应格式不正确", {
        status: response.status,
      })
    }
    return payload.data as T
  })()
  try {
    return await Promise.race([requestResult, timeoutFailure])
  } catch (error) {
    if (error instanceof PushGatewayRequestError) throw error
    throw new PushGatewayRequestError(
      didTimeout || (error instanceof Error && error.name === "AbortError")
        ? "推送网关请求超时"
        : "无法连接推送网关"
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function readGatewayJSON(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined
  try {
    return (await response.json()) as GatewayErrorEnvelope | unknown
  } catch {
    throw new PushGatewayRequestError("推送网关响应格式不正确", {
      status: response.status,
    })
  }
}

function normalizeGrantCredential(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.grant_id !== "string" ||
    !value.grant_id ||
    typeof value.send_token !== "string" ||
    !value.send_token ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new PushGatewayRequestError("推送授权响应格式不正确")
  }
  return {
    expiresAt: value.expires_at,
    grantId: value.grant_id,
    sendToken: value.send_token,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
