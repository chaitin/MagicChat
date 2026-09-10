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
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("push-gateway-admin-unauthorized"))
    }
    let code = `http_${response.status}`
    let message = "请求失败，请稍后重试"
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string }
      }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // Keep the generic response for non-JSON failures.
    }
    throw new APIError(code, message, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
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
