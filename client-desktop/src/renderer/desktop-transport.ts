import {
  targetKey,
  type AuthenticatedTarget,
  type RealtimeEnvelope,
  type RealtimeSnapshot,
} from "@shared/client-contract"
import type { RealtimeDiagnosticContext } from "@shared/diagnostics-contract"
import type { RealtimeTransportState, RealtimeWebSocketLike } from "@/lib/realtime-client"
import { randomUUID } from "./random-id"
import { beginDiagnosticRequest } from "@/lib/runtime-diagnostics"
import { recordRendererDiagnostic } from "@/lib/desktop-diagnostics"

export function installDesktopFetch(target: AuthenticatedTarget): () => void {
  const original = window.fetch.bind(window)
  const lifecycle = new AbortController()
  const activeRequestIds = new Set<string>()
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url, window.location.href)
    if (!url.pathname.startsWith("/api/client/")) return original(input, init)
    const signal = AbortSignal.any([request.signal, lifecycle.signal])
    throwIfAborted(signal)
    const method = request.method.toUpperCase() as "DELETE" | "GET" | "PATCH" | "POST" | "PUT"
    const finishDiagnostic = beginDiagnosticRequest(method, url.pathname)
    try {
      if (request.body && request.headers.get("content-type")?.includes("multipart/form-data")) {
        const response = await streamMultipartRequest(
          target,
          request,
          `${url.pathname}${url.search}`,
          method,
          signal,
        )
        finishDiagnostic(response.status)
        return response
      }
      let body: { kind: "text"; value: string } | undefined
      if (method !== "GET" && method !== "DELETE")
        body = { kind: "text", value: await request.text() }
      const requestId = randomUUID()
      activeRequestIds.add(requestId)
      const response = await runAbortable(
        signal,
        () =>
          window.desktop.transport.request(target, {
            body,
            headers: Object.fromEntries(request.headers.entries()),
            method,
            path: `${url.pathname}${url.search}`,
            requestId,
          }),
        () => void window.desktop.transport.cancel(requestId).catch(() => undefined),
      ).finally(() => activeRequestIds.delete(requestId))
      const headers = new Headers(response.headers)
      const responseBody =
        response.body instanceof Uint8Array
          ? new Blob([Uint8Array.from(response.body)])
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body)
      if (
        url.pathname.endsWith("/auth/login") ||
        url.pathname.endsWith("/auth/email-code/login") ||
        url.pathname.endsWith("/me")
      ) {
        const data = response.body as { data?: { user?: { id?: string } } }
        if (data?.data?.user?.id)
          window.dispatchEvent(
            new CustomEvent("magicchat:authenticated", { detail: { userId: data.data.user.id } }),
          )
      }
      finishDiagnostic(response.status)
      return new Response(responseBody, { headers, status: response.status })
    } catch (error) {
      finishDiagnostic()
      throw error
    }
  }
  return () => {
    lifecycle.abort(new DOMException("请求已取消", "AbortError"))
    for (const requestId of activeRequestIds) {
      void window.desktop.transport.cancel(requestId).catch(() => undefined)
    }
    activeRequestIds.clear()
    window.fetch = original
  }
}

async function streamMultipartRequest(
  target: AuthenticatedTarget,
  request: Request,
  path: string,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  signal: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal)
  if (!request.body) throw new Error("上传请求缺少内容")
  const streamId = await window.desktop.transport.streamStart(target, {
    headers: Object.fromEntries(request.headers.entries()),
    method,
    path,
    requestId: randomUUID(),
  })
  if (signal.aborted) {
    await window.desktop.transport.streamAbort(streamId).catch(() => undefined)
    throw abortReason(signal)
  }
  const abort = () => {
    void window.desktop.transport.streamAbort(streamId)
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await runAbortable(signal, () => reader.read(), abort)
      if (done) break
      for (let offset = 0; offset < value.byteLength; offset += 256 * 1024) {
        await runAbortable(
          signal,
          () =>
            window.desktop.transport.streamChunk(
              streamId,
              value.slice(offset, offset + 256 * 1024),
            ),
          abort,
        )
      }
    }
    const response = await runAbortable(
      signal,
      () => window.desktop.transport.streamFinish(streamId),
      abort,
    )
    const contentType = response.headers["content-type"] ?? "application/json"
    return new Response(
      typeof response.body === "string" ? response.body : JSON.stringify(response.body),
      {
        headers: { "content-type": contentType },
        status: response.status,
      },
    )
  } catch (error) {
    await window.desktop.transport.streamAbort(streamId).catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

function runAbortable<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  cancel: () => void,
): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cancel()
      reject(abortReason(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        if (signal.aborted) reject(abortReason(signal))
        else resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(signal.aborted ? abortReason(signal) : error)
      },
    )
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("请求已取消", "AbortError")
}

export class DesktopWebSocket implements RealtimeWebSocketLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  readonly transportStateIsAuthoritative = true
  readyState = DesktopWebSocket.CONNECTING
  private readonly unsubscribe: () => void
  private readonly unsubscribeSnapshot: () => void
  private readonly unsubscribeUnauthorized: () => void
  private latestSnapshot?: RealtimeSnapshot
  private latestStateRevision = -1
  private receivedSnapshot = false
  private transportStateListener: ((state: RealtimeTransportState) => void) | null = null

  constructor(private readonly target: AuthenticatedTarget) {
    this.unsubscribe = window.desktop.realtime.subscribe((envelope) => this.receive(envelope))
    this.unsubscribeSnapshot = window.desktop.realtime.subscribeSnapshot((snapshot) =>
      this.receiveSnapshot(snapshot),
    )
    this.unsubscribeUnauthorized = window.desktop.realtime.subscribeUnauthorized((target) => {
      if (
        targetKey(target) !== targetKey(this.target) ||
        this.readyState === DesktopWebSocket.CLOSED
      )
        return
      this.readyState = DesktopWebSocket.CLOSED
      this.unsubscribe()
      this.unsubscribeSnapshot()
      this.unsubscribeUnauthorized()
      this.recordState("disconnected")
      this.onclose?.(new CloseEvent("close", { code: 1008, reason: "unauthorized" }))
    })
    void window.desktop.realtime
      .connect(target)
      .then((snapshot) => {
        const receivedSnapshot = this.receivedSnapshot
        this.applySnapshot(snapshot)
        if (!receivedSnapshot) {
          void recordRendererDiagnostic(
            "realtime-bridge.snapshot-missed",
            this.diagnosticContext(),
            {
              reason: "unknown",
            },
          )
        }
        this.readyState = DesktopWebSocket.OPEN
        this.onopen?.(new Event("open"))
      })
      .catch(() => {
        this.readyState = DesktopWebSocket.CLOSED
        this.recordState("disconnected")
        this.onerror?.(new Event("error"))
        this.onclose?.(new CloseEvent("close"))
      })
  }

  close(): void {
    if (this.readyState >= DesktopWebSocket.CLOSING) return
    this.readyState = DesktopWebSocket.CLOSING
    this.unsubscribe()
    this.unsubscribeSnapshot()
    this.unsubscribeUnauthorized()
    void window.desktop.realtime.close(this.target).finally(() => {
      this.readyState = DesktopWebSocket.CLOSED
      this.recordState("disconnected")
      this.onclose?.(new CloseEvent("close"))
    })
  }

  send(data: string): void {
    if (this.readyState !== DesktopWebSocket.OPEN)
      throw new DOMException("连接尚未建立", "InvalidStateError")
    let request: { id?: string; method?: string; payload?: unknown }
    try {
      request = JSON.parse(data) as typeof request
    } catch {
      throw new Error("实时请求格式无效")
    }
    if (!request.id || !request.method) throw new Error("实时请求字段无效")
    void window.desktop.realtime
      .send(this.target, request.method, request.payload)
      .then((payload) => {
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              v: 1,
              kind: "response",
              ok: true,
              reply_to: request.id,
              payload,
            }),
          }),
        )
      })
      .catch((error: unknown) => {
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify({
              v: 1,
              kind: "response",
              ok: false,
              reply_to: request.id,
              error: { message: error instanceof Error ? error.message : "实时请求失败" },
            }),
          }),
        )
      })
  }

  set ontransportstatechange(listener: ((state: RealtimeTransportState) => void) | null) {
    this.transportStateListener = listener
    const snapshot = this.latestSnapshot
    if (listener && snapshot) listener({ ready: snapshot.ready, status: snapshot.status })
  }

  get ontransportstatechange() {
    return this.transportStateListener
  }

  private receive(envelope: RealtimeEnvelope): void {
    if (
      envelope.targetKey &&
      !envelope.targetKey.endsWith(`:${encodeURIComponent(this.target.userId)}`)
    )
      return
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(envelope) }))
  }

  diagnosticContext(): RealtimeDiagnosticContext | undefined {
    const snapshot = this.latestSnapshot
    if (!snapshot?.connectionInstanceId || !snapshot.episodeId || !snapshot.targetScope)
      return undefined
    return {
      connectionInstanceId: snapshot.connectionInstanceId,
      episodeId: snapshot.episodeId,
      targetScope: snapshot.targetScope,
    }
  }

  private recordState(status: RealtimeSnapshot["status"]): void {
    const context = this.diagnosticContext()
    if (!context) return
    void recordRendererDiagnostic("realtime.state-changed", context, { ready: false, status })
  }

  private receiveSnapshot(snapshot: RealtimeSnapshot): void {
    if (!this.applySnapshot(snapshot)) return
    this.receivedSnapshot = true
    void recordRendererDiagnostic("realtime-bridge.snapshot-received", this.diagnosticContext(), {
      ready: snapshot.ready,
      status: snapshot.status,
    })
  }

  private applySnapshot(snapshot: RealtimeSnapshot): boolean {
    if (
      snapshot.targetKey !== targetKey(this.target) ||
      snapshot.stateRevision <= this.latestStateRevision
    )
      return false
    this.latestSnapshot = snapshot
    this.latestStateRevision = snapshot.stateRevision
    this.transportStateListener?.({ ready: snapshot.ready, status: snapshot.status })
    return true
  }
}
