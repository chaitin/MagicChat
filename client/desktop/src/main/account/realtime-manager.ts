import { randomUUID } from "node:crypto"
import WebSocket, { type RawData } from "ws"
import { AuthFailure, isRecord } from "../../shared/auth"

const MAX_BUFFERED_EVENTS = 1_000
const MAX_MESSAGE_BYTES = 1024 * 1024
const HEARTBEAT_TIMEOUT_MS = 65_000
const READY_EVENT = "system.ready"

export type RealtimeEvent = {
  id: string
  cursor: number | null
  name: string
  payload: unknown
}

export type RealtimeState = "loading" | "ready"

export class RealtimeManager {
  private socket?: WebSocket
  private reconnectTimer?: NodeJS.Timeout
  private heartbeatTimer?: NodeJS.Timeout
  private reconnectAttempt = 0
  private generation = 0
  private running = false
  private ready = false
  private synchronizing = false
  private bufferedEvents: RealtimeEvent[] = []
  private overflowed = false
  private eventQueue = Promise.resolve()
  private readyWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []

  constructor(
    private readonly options: {
      serverUrl: string
      token: string
      synchronize: () => Promise<void>
      applyEvent: (event: RealtimeEvent) => Promise<void>
      onStateChange: (state: RealtimeState) => void
    },
  ) {}

  start(): Promise<void> {
    if (!this.running) {
      this.running = true
      this.setLoading()
      this.connect()
    }
    return this.waitUntilReady()
  }

  waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (!this.running) {
      return Promise.reject(new AuthFailure("realtime_closed", "实时连接已关闭"))
    }
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }))
  }

  close() {
    if (!this.running) return
    this.running = false
    this.ready = false
    this.synchronizing = false
    this.generation += 1
    this.bufferedEvents = []
    this.clearReconnectTimer()
    this.clearHeartbeatTimer()
    const socket = this.socket
    this.socket = undefined
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close()
    this.rejectReadyWaiters(new AuthFailure("realtime_closed", "实时连接已关闭"))
  }

  private connect() {
    if (!this.running || this.socket || this.reconnectTimer) return
    const generation = ++this.generation
    const socket = new WebSocket(buildRealtimeWebSocketUrl(this.options.serverUrl), {
      headers: { Authorization: `Bearer ${this.options.token}` },
      handshakeTimeout: 20_000,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    })
    this.socket = socket
    this.bufferedEvents = []
    this.overflowed = false

    socket.on("open", () => this.armHeartbeat(socket, generation))
    socket.on("ping", () => this.armHeartbeat(socket, generation))
    socket.on("message", (data, isBinary) => {
      if (isBinary || !this.isCurrent(socket, generation)) return
      this.armHeartbeat(socket, generation)
      this.handleMessage(socket, generation, data)
    })
    socket.on("close", () => this.handleClose(socket, generation))
    socket.on("error", () => undefined)
    socket.on("unexpected-response", (_request, response) => {
      response.resume()
      if (response.statusCode === 401 || response.statusCode === 403) {
        this.failPermanently(new AuthFailure("unauthorized", "登录已失效，请重新登录"))
      } else {
        socket.terminate()
      }
    })
  }

  private handleMessage(socket: WebSocket, generation: number, data: RawData) {
    const envelope = parseEnvelope(data)
    if (!envelope || !this.isCurrent(socket, generation)) return
    if (envelope.name === READY_EVENT) {
      if (!this.synchronizing && !this.ready) void this.synchronize(socket, generation)
      return
    }
    if (this.synchronizing || !this.ready) {
      if (this.bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
        this.overflowed = true
        socket.terminate()
        return
      }
      this.bufferedEvents.push(envelope)
      return
    }
    this.enqueueEvent(socket, generation, envelope)
  }

  private async synchronize(socket: WebSocket, generation: number) {
    this.synchronizing = true
    try {
      await this.eventQueue
      if (!this.isCurrent(socket, generation)) return
      await this.options.synchronize()
      while (this.bufferedEvents.length > 0) {
        const event = this.bufferedEvents.shift()
        if (event) await this.options.applyEvent(event)
        if (!this.isCurrent(socket, generation) || this.overflowed) return
      }
      if (!this.isCurrent(socket, generation) || this.overflowed) return
      this.synchronizing = false
      this.ready = true
      this.reconnectAttempt = 0
      this.options.onStateChange("ready")
      this.resolveReadyWaiters()
    } catch {
      if (this.isCurrent(socket, generation)) socket.terminate()
    }
  }

  private enqueueEvent(socket: WebSocket, generation: number, event: RealtimeEvent) {
    this.eventQueue = this.eventQueue
      .then(async () => {
        if (!this.isCurrent(socket, generation) || !this.ready) return
        await this.options.applyEvent(event)
      })
      .catch(() => {
        if (this.isCurrent(socket, generation)) socket.terminate()
      })
  }

  private handleClose(socket: WebSocket, generation: number) {
    if (!this.isCurrent(socket, generation)) return
    this.socket = undefined
    this.clearHeartbeatTimer()
    this.synchronizing = false
    this.bufferedEvents = []
    this.setLoading()
    if (!this.running) return
    const delaySeconds = Math.min(++this.reconnectAttempt, 30)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delaySeconds * 1_000)
  }

  private setLoading() {
    if (this.ready) this.ready = false
    this.options.onStateChange("loading")
  }

  private failPermanently(error: AuthFailure) {
    this.running = false
    this.ready = false
    this.synchronizing = false
    this.clearReconnectTimer()
    this.clearHeartbeatTimer()
    const socket = this.socket
    this.socket = undefined
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate()
    this.rejectReadyWaiters(error)
  }

  private isCurrent(socket: WebSocket, generation: number) {
    return this.running && this.socket === socket && this.generation === generation
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private armHeartbeat(socket: WebSocket, generation: number) {
    this.clearHeartbeatTimer()
    this.heartbeatTimer = setTimeout(() => {
      if (this.isCurrent(socket, generation)) socket.terminate()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private clearHeartbeatTimer() {
    if (!this.heartbeatTimer) return
    clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private resolveReadyWaiters() {
    const waiters = this.readyWaiters.splice(0)
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectReadyWaiters(error: unknown) {
    const waiters = this.readyWaiters.splice(0)
    for (const waiter of waiters) waiter.reject(error)
  }
}

function buildRealtimeWebSocketUrl(serverUrl: string) {
  const url = new URL("api/client/ws", `${serverUrl.replace(/\/+$/, "")}/`)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function parseEnvelope(data: RawData): RealtimeEvent | null {
  let value: unknown
  try {
    value = JSON.parse(rawDataText(data))
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    value.kind !== "event" ||
    typeof value.event !== "string" ||
    !value.event
  ) {
    return null
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : randomUUID(),
    cursor: Number.isSafeInteger(value.cursor) ? Number(value.cursor) : null,
    name: value.event,
    payload: value.payload,
  }
}

function rawDataText(data: RawData) {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}
