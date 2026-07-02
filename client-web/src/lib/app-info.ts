type ClientInfoFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type ClientInfoSuccessEnvelope<T> = {
  data?: T
  success?: boolean
}

type ClientInfoErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

type ClientInfoResponse = {
  app_name?: string
  organization_name?: string
}

export type AppInfo = {
  appName: string
  organizationName: string
}

export const defaultAppInfo: AppInfo = {
  appName: "MyGod",
  organizationName: "长亭科技",
}

export class ClientInfoRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "ClientInfoRequestError"
    this.code = options?.code
  }
}

export async function getClientInfo(fetcher: ClientInfoFetch = fetch) {
  const response = await fetcher("/api/client/info", {
    method: "GET",
  })
  const payload = await readJson<
    ClientInfoErrorEnvelope | ClientInfoSuccessEnvelope<ClientInfoResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载应用信息失败")
  }

  const data = (
    payload as ClientInfoSuccessEnvelope<ClientInfoResponse> | undefined
  )?.data

  return normalizeClientInfo(data)
}

function createRequestError(
  payload:
    ClientInfoErrorEnvelope | ClientInfoSuccessEnvelope<unknown> | undefined,
  response: Response,
  fallbackMessage: string
) {
  const error = (payload as ClientInfoErrorEnvelope | undefined)?.error

  return new ClientInfoRequestError(
    error?.message ?? `${fallbackMessage}（HTTP ${response.status}）`,
    {
      code: error?.code,
    }
  )
}

function normalizeClientInfo(info: ClientInfoResponse | undefined): AppInfo {
  if (!info?.app_name || !info.organization_name) {
    throw new ClientInfoRequestError("应用信息响应格式不正确")
  }

  return {
    appName: info.app_name,
    organizationName: info.organization_name,
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
