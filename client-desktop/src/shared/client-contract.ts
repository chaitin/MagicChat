export const CLIENT_PROTOCOL_VERSION = 1 as const

export type ServerTarget = Readonly<{
  id: string
  normalizedUrl: string
}>

export type AuthenticatedTarget = ServerTarget &
  Readonly<{
    userId: string
  }>

export type ClientRequestBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "bytes"; value: Uint8Array }

export type ClientRequest = Readonly<{
  body?: ClientRequestBody
  headers?: Readonly<Record<string, string>>
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
  path: string
  requestId: string
  timeoutMs?: number
}>

export type ClientResponse<T = unknown> = Readonly<{
  body: T
  headers: Readonly<Record<string, string>>
  status: number
}>

export type ClientErrorCode =
  | "aborted"
  | "incompatible_server"
  | "invalid_request"
  | "network"
  | "response_too_large"
  | "timeout"
  | "tls"
  | "unauthorized"
  | "unsupported_mtls"
  | "unknown"

export class ClientTransportError extends Error {
  readonly code: ClientErrorCode
  readonly status?: number

  constructor(code: ClientErrorCode, message: string, status?: number) {
    super(message)
    this.name = "ClientTransportError"
    this.code = code
    this.status = status
  }
}

export type RealtimeEnvelope = Readonly<{
  error?: Readonly<{ code?: string; message?: string }>
  event?: string
  id?: string
  kind: "event" | "request" | "response"
  method?: string
  ok?: boolean
  payload?: unknown
  reply_to?: string
  targetKey?: string
  v: typeof CLIENT_PROTOCOL_VERSION
}>

export type RealtimeSnapshot = Readonly<{
  connectionInstanceId?: string
  episodeId?: string
  ready: boolean
  /** 同一认证目标的 Main 实时状态单调版本，用于丢弃迟到 IPC 快照。 */
  stateRevision: number
  status: "connected" | "connecting" | "disconnected" | "reconnecting"
  targetKey: string
  targetScope?: string
}>

export interface RealtimeSubscription {
  close(): void
  send(method: string, payload: unknown): Promise<unknown>
  subscribe(listener: (envelope: RealtimeEnvelope) => void): () => void
  snapshot(): RealtimeSnapshot
}

export interface ClientTransport {
  cancel(requestId: string): void
  connectRealtime(target: AuthenticatedTarget): RealtimeSubscription
  request<T>(target: AuthenticatedTarget, request: ClientRequest): Promise<ClientResponse<T>>
}

export function normalizeServerUrl(value: string, allowHttp = false): string {
  const input = value.trim()
  if (input.length === 0 || input.length > 2048) {
    throw new ClientTransportError("invalid_request", "服务器地址无效")
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ClientTransportError("invalid_request", "服务器地址格式错误")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ClientTransportError("invalid_request", "服务器地址不能包含凭据、查询或片段")
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new ClientTransportError("invalid_request", "服务器必须使用 HTTPS")
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"
  return url.toString().replace(/\/$/, "")
}

export function targetKey(target: AuthenticatedTarget): string {
  return `${encodeURIComponent(target.id)}:${encodeURIComponent(target.normalizedUrl)}:${encodeURIComponent(target.userId)}`
}

export function assertClientPath(path: string): string {
  if (path.length > 4096 || !path.startsWith("/api/client/") || path.includes("\\")) {
    throw new ClientTransportError("invalid_request", "API 路径不在允许范围内")
  }
  const url = new URL(path, "https://local.invalid")
  if (
    url.origin !== "https://local.invalid" ||
    !url.pathname.startsWith("/api/client/") ||
    url.pathname.split("/").includes("..")
  ) {
    throw new ClientTransportError("invalid_request", "API 路径包含越界内容")
  }
  return `${url.pathname}${url.search}`
}

export function normalizeTransportError(error: unknown): ClientTransportError {
  if (error instanceof ClientTransportError) return error
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ClientTransportError("aborted", "请求已取消")
  }
  return new ClientTransportError("unknown", error instanceof Error ? error.message : "未知错误")
}
