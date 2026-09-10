export class APIError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = "APIError"
    this.code = code
    this.status = status
  }
}

export async function requestJSON<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set("Content-Type", "application/json")
  const method = (init.method ?? "GET").toUpperCase()
  if (method !== "GET" && method !== "HEAD") {
    const csrfToken = readCookie("push_gateway_admin_csrf")
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  })
  if (response.status === 204) return undefined as T

  const payload = await readJSON(response)
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("push-gateway-admin-unauthorized"))
    }
    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
    throw new APIError(
      typeof error?.code === "string" ? error.code : `http_${response.status}`,
      typeof error?.message === "string"
        ? error.message
        : "请求失败，请稍后重试",
      response.status
    )
  }
  if (!isRecord(payload) || payload.success !== true || !("data" in payload)) {
    throw new APIError(
      "invalid_response",
      "服务端响应格式错误",
      response.status
    )
  }
  return payload.data as T
}

async function readJSON(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw new APIError(
      "invalid_response",
      "服务端响应格式错误",
      response.status
    )
  }
}

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`
  for (const part of document.cookie.split(";")) {
    const value = part.trim()
    if (value.startsWith(prefix)) {
      return decodeURIComponent(value.slice(prefix.length))
    }
  }
  return ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
