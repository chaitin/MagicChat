import { createClientMessageId } from "@/lib/message-id"
import type { DiagnosticContext, RealtimeDiagnosticContext } from "@shared/diagnostics-contract"
import { recordRealtimeParseFailure, recordRendererDiagnostic } from "@/lib/desktop-diagnostics"

export type RealtimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected"

export type RealtimeSnapshot = {
  ready: boolean
  status: RealtimeConnectionStatus
}

export type RealtimeTransportState = RealtimeSnapshot

export type RealtimeWebSocketLike = {
  close: () => void
  diagnosticContext?: () => DiagnosticContext | undefined
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onopen: ((event: Event) => void) | null
  ontransportstatechange?: ((state: RealtimeTransportState) => void) | null
  transportStateIsAuthoritative?: boolean
  readyState: number
  send: (data: string) => void
}

type RealtimeEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  event?: string
  id?: string
  kind?: string
  ok?: boolean
  payload?: unknown
  reply_to?: string
  v?: number
}

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
}

export type RealtimeEventHandler = (payload: unknown) => void

type RealtimeClientOptions = {
  authCheck?: () => boolean | Promise<boolean>
  createWebSocket?: (url: string) => RealtimeWebSocketLike
  onUnauthorized?: () => void
  reconnectDelaysMs?: number[]
  url?: string
}

const protocolVersion = 1
const defaultReconnectDelaysMs = [500, 1_000, 2_000, 5_000, 10_000, 30_000]

export class RealtimeClient {
  private authCheck?: () => boolean | Promise<boolean>
  private createWebSocket: (url: string) => RealtimeWebSocketLike
  private eventListeners = new Map<string, Set<RealtimeEventHandler>>()
  private listeners = new Set<() => void>()
  private onUnauthorized?: () => void
  private pendingRequests = new Map<string, PendingRequest>()
  private ready = false
  private reconnectAttempt = 0
  private reconnectDelaysMs: number[]
  private reconnectSequence = 0
  private reconnectTimer: number | null = null
  private shouldReconnect = false
  private socket: RealtimeWebSocketLike | null = null
  private status: RealtimeConnectionStatus = "disconnected"
  private systemReadyCount = 0
  private url: string

  constructor(options: RealtimeClientOptions = {}) {
    this.authCheck = options.authCheck
    this.url = options.url ?? buildRealtimeWebSocketURL(window.location)
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url))
    this.onUnauthorized = options.onUnauthorized
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? defaultReconnectDelaysMs
  }

  connect() {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return
    }

    this.shouldReconnect = true
    this.openSocket("connecting")
  }

  disconnect() {
    const previousReady = this.ready
    const previousStatus = this.status
    const diagnosticContext = this.diagnosticContext()
    this.shouldReconnect = false
    this.reconnectSequence += 1
    this.clearReconnectTimer()
    this.rejectPendingRequests(new Error("实时连接已断开"), "cancelled", diagnosticContext)
    this.ready = false
    this.status = "disconnected"
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.recordState(previousStatus, previousReady, diagnosticContext)
    this.notify()
  }

  getSnapshot(): RealtimeSnapshot {
    return {
      ready: this.ready,
      status: this.status,
    }
  }

  sendRequest(method: string, payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("实时连接未建立"))
    }

    const id = createClientMessageId()
    const request = {
      v: protocolVersion,
      kind: "request",
      id,
      method,
      payload,
    }

    const socket = this.socket
    const message = JSON.stringify(request)

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { reject, resolve })
      try {
        socket.send(message)
      } catch {
        this.pendingRequests.delete(id)
        reject(new Error("发送实时请求失败"))
      }
    })
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeEvent(eventName: string, handler: RealtimeEventHandler) {
    const eventListeners = this.eventListeners.get(eventName) ?? new Set()
    eventListeners.add(handler)
    this.eventListeners.set(eventName, eventListeners)

    return () => {
      eventListeners.delete(handler)
      if (eventListeners.size === 0) {
        this.eventListeners.delete(eventName)
      }
    }
  }

  private openSocket(status: RealtimeConnectionStatus, diagnosticContext?: DiagnosticContext) {
    const previousReady = this.ready
    const previousStatus = this.status
    this.clearReconnectTimer()
    this.ready = false
    this.status = status
    this.recordState(previousStatus, previousReady, diagnosticContext)
    this.notify()

    const socket = this.createWebSocket(this.url)
    this.socket = socket
    socket.onopen = () => {
      if (socket.transportStateIsAuthoritative) return
      const previousStatus = this.status
      this.reconnectAttempt = 0
      this.status = "connected"
      this.recordState(previousStatus, this.ready)
      this.notify()
    }
    socket.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    socket.onerror = () => undefined
    socket.onclose = () => {
      void this.handleSocketClose(socket)
    }
    socket.ontransportstatechange = (state) => {
      this.handleTransportState(socket, state)
    }
  }

  // Desktop 模式下 Main 持有真实 WebSocket 与重连循环；Renderer 仅镜像其状态。
  private handleTransportState(socket: RealtimeWebSocketLike, state: RealtimeTransportState) {
    if (this.socket !== socket) return

    const previousReady = this.ready
    const previousStatus = this.status
    if (previousReady === state.ready && previousStatus === state.status) return

    this.ready = state.ready
    this.status = state.status
    if (!state.ready)
      this.rejectPendingRequests(
        new Error("实时连接已断开"),
        "network",
        socket.diagnosticContext?.(),
      )
    this.recordState(previousStatus, previousReady, socket.diagnosticContext?.())
    this.notify()
  }

  private async handleSocketClose(socket: RealtimeWebSocketLike) {
    if (this.socket !== socket) return
    const diagnosticContext = socket.diagnosticContext?.()
    this.socket = null
    this.rejectPendingRequests(new Error("实时连接已断开"), "network", diagnosticContext)
    const previousReady = this.ready
    const previousStatus = this.status
    this.ready = false
    if (!this.shouldReconnect) {
      this.status = "disconnected"
      this.recordState(previousStatus, previousReady, diagnosticContext)
      this.notify()
      return
    }

    const reconnectSequence = this.reconnectSequence + 1
    this.reconnectSequence = reconnectSequence
    this.status = "reconnecting"
    this.recordState(previousStatus, previousReady, diagnosticContext)
    this.notify()

    if (!this.authCheck) {
      this.scheduleReconnect(diagnosticContext)
      return
    }

    const authorized = await this.checkReconnectAuthorization()
    if (reconnectSequence !== this.reconnectSequence || !this.shouldReconnect || this.socket) {
      return
    }
    if (!authorized) {
      this.shouldReconnect = false
      this.clearReconnectTimer()
      this.status = "disconnected"
      this.recordState("reconnecting", false, diagnosticContext)
      this.notify()
      this.onUnauthorized?.()
      return
    }

    this.scheduleReconnect(diagnosticContext)
  }

  private async checkReconnectAuthorization() {
    try {
      return await this.authCheck!()
    } catch {
      return true
    }
  }

  private scheduleReconnect(diagnosticContext?: DiagnosticContext) {
    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ??
      defaultReconnectDelaysMs[defaultReconnectDelaysMs.length - 1]
    this.reconnectAttempt += 1
    void recordRendererDiagnostic("realtime.reconnect-scheduled", diagnosticContext, {
      attempt: this.reconnectAttempt,
      durationMs: delay,
    })
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.shouldReconnect) {
        return
      }
      this.openSocket("connecting", diagnosticContext)
    }, delay)
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") {
      recordRealtimeParseFailure()
      return
    }

    let envelope: RealtimeEnvelope
    try {
      envelope = JSON.parse(data) as RealtimeEnvelope
    } catch {
      recordRealtimeParseFailure()
      return
    }
    if (envelope.v !== protocolVersion) {
      recordRealtimeParseFailure()
      return
    }

    if (envelope.kind === "event") {
      this.handleEvent(envelope)
      return
    }
    if (envelope.kind === "response") {
      this.handleResponse(envelope)
    }
  }

  private handleEvent(envelope: RealtimeEnvelope) {
    if (envelope.event === "system.ready") {
      const previousReady = this.ready
      this.ready = true
      this.systemReadyCount += 1
      void recordRendererDiagnostic("realtime.system-ready", this.diagnosticContext(), {
        previousReady,
        ready: true,
        status: this.status,
        systemReadyCount: this.systemReadyCount,
      })
      this.notify()
      this.dispatchEvent("system.ready", envelope.payload)
      return
    }

    if (envelope.event) {
      this.dispatchEvent(envelope.event, envelope.payload)
    }
  }

  private handleResponse(envelope: RealtimeEnvelope) {
    const replyTo = envelope.reply_to
    if (!replyTo) {
      return
    }

    const pending = this.pendingRequests.get(replyTo)
    if (!pending) {
      return
    }
    this.pendingRequests.delete(replyTo)

    if (envelope.ok) {
      pending.resolve(envelope.payload)
      return
    }

    pending.reject(new Error(envelope.error?.message ?? "实时请求失败"))
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) {
      return
    }
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private rejectPendingRequests(
    error: Error,
    reason?: "cancelled" | "network",
    context?: DiagnosticContext,
  ) {
    const pendingRequestCount = this.pendingRequests.size
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
    if (pendingRequestCount > 0 && reason && isRealtimeDiagnosticContext(context))
      void recordRendererDiagnostic("realtime.state-changed", context, {
        pendingRequestCount,
        reason,
        ready: this.ready,
        status: this.status,
      })
  }

  private diagnosticContext(): DiagnosticContext | undefined {
    return this.socket?.diagnosticContext?.()
  }

  private recordState(
    previousStatus: RealtimeConnectionStatus,
    previousReady: boolean,
    diagnosticContext?: DiagnosticContext,
  ): void {
    const context = diagnosticContext ?? this.diagnosticContext()
    if (!isRealtimeDiagnosticContext(context)) return
    void recordRendererDiagnostic("realtime.state-changed", context, {
      previousReady,
      previousStatus,
      ready: this.ready,
      status: this.status,
    })
  }

  private notify() {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private dispatchEvent(eventName: string, payload: unknown) {
    const eventListeners = this.eventListeners.get(eventName)
    if (!eventListeners) {
      return
    }

    for (const listener of eventListeners) {
      listener(payload)
    }
  }
}

function isRealtimeDiagnosticContext(
  context: DiagnosticContext | undefined,
): context is RealtimeDiagnosticContext {
  return Boolean(context?.connectionInstanceId && context.episodeId && context.targetScope)
}

export function buildRealtimeWebSocketURL(location: Pick<Location | URL, "host" | "protocol">) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"

  return `${protocol}//${location.host}/api/client/ws`
}
