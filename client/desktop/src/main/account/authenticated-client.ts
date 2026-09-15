import { type Session } from "electron"
import { AuthFailure, isRecord } from "../../shared/auth"

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

export class AuthenticatedClient {
  constructor(
    private readonly serverUrl: string,
    private readonly serverSession: Session,
    private readonly token: string,
  ) {}

  get(path: string): Promise<unknown> {
    return this.request(path, "GET")
  }

  post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(path, "POST", body)
  }

  private async request(
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!endpoint.startsWith("/api/client/") || endpoint.includes("\\")) {
      throw new AuthFailure("invalid_endpoint", "数据请求地址不受支持")
    }
    try {
      const response = await this.serverSession.fetch(`${this.serverUrl}${endpoint}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        signal: AbortSignal.timeout(20_000),
      })
      const payload = await readJson(response)
      if (!response.ok || (isRecord(payload) && payload.success === false)) {
        const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
        throw new AuthFailure(
          typeof error?.code === "string" ? error.code : `http_${response.status}`,
          typeof error?.message === "string" ? error.message : "账号数据请求失败",
        )
      }
      if (!isRecord(payload) || !("data" in payload)) {
        throw new AuthFailure("invalid_response", "账号数据响应格式不正确")
      }
      return payload.data
    } catch (error) {
      if (error instanceof AuthFailure) throw error
      throw new AuthFailure(
        "network",
        error instanceof Error && error.name === "TimeoutError"
          ? "账号数据请求超时"
          : "无法连接账号数据服务",
      )
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AuthFailure("invalid_response", "账号数据响应为空")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AuthFailure("response_too_large", "账号数据响应过大")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AuthFailure("invalid_response", "账号数据响应格式不正确")
  }
}
