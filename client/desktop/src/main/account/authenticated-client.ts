import { type Session } from "electron"
import { AuthFailure, isRecord } from "../../shared/auth"

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const AVATAR_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
])

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

  async downloadAvatar(sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    let url: URL
    try {
      url = new URL(sourceUrl, `${this.serverUrl}/`)
    } catch {
      throw new AuthFailure("invalid_avatar_url", "头像地址格式不正确")
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new AuthFailure("invalid_avatar_url", "头像地址格式不正确")
    }
    const serverOrigin = new URL(this.serverUrl).origin
    try {
      const response = await this.serverSession.fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml",
          ...(url.origin === serverOrigin ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        credentials: "omit",
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new AuthFailure("avatar_download", "头像下载失败")
      if (response.url) {
        const finalUrl = new URL(response.url)
        if (finalUrl.protocol !== "https:" && finalUrl.protocol !== "http:") {
          throw new AuthFailure("avatar_download", "头像下载失败")
        }
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? ""
      if (!AVATAR_CONTENT_TYPES.has(contentType)) {
        throw new AuthFailure("invalid_avatar", "头像文件格式不受支持")
      }
      const bytes = await readBytes(response, MAX_AVATAR_BYTES)
      const detectedContentType = detectAvatarContentType(bytes)
      if (!detectedContentType) {
        throw new AuthFailure("invalid_avatar", "头像文件内容不正确")
      }
      return { bytes, contentType: detectedContentType }
    } catch (error) {
      if (error instanceof AuthFailure) throw error
      throw new AuthFailure("avatar_download", "头像下载失败")
    }
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
  const bytes = await readBytes(response, MAX_RESPONSE_BYTES)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new AuthFailure("invalid_response", "账号数据响应格式不正确")
  }
}

function detectAvatarContentType(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength === 0) return undefined
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return "image/png"
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  const decoder = new TextDecoder()
  const signature = decoder.decode(bytes.subarray(0, 12))
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) return "image/gif"
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") return "image/webp"
  const source = decoder.decode(bytes.subarray(0, 32 * 1_024))
  if (
    /<svg(?:\s|>)/i.test(source) &&
    !/<script(?:\s|>)/i.test(source) &&
    !/<foreignObject(?:\s|>)/i.test(source) &&
    !/\son[a-z]+\s*=/i.test(source) &&
    !/(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(source)
  ) {
    return "image/svg+xml"
  }
  return undefined
}

async function readBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new AuthFailure("invalid_response", "响应内容为空")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) throw new AuthFailure("response_too_large", "响应内容过大")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
