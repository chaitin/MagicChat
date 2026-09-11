import type { AccountAuthSnapshot, AuthResolver } from "@/data/api-client"
import { assertSecureTransport } from "@/data/auth/security-boundaries"
import { parseRealtimeEnvelope, realtimeEvents } from "@/realtime/realtime-protocol"

export type RealtimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected"
export type RealtimeSnapshot = { ready: boolean; status: RealtimeConnectionStatus }

export type RealtimeSocket = Pick<WebSocket, "close" | "onclose" | "onerror" | "onmessage" | "onopen" | "readyState">
export type RealtimeSocketFactory = (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: { Authorization: string } }
) => RealtimeSocket

type RealtimeClientOptions = {
  auth?: AuthResolver
  authCheck?: () => boolean | Promise<boolean>
  createSocket?: RealtimeSocketFactory
  isCurrent?: (snapshot: AccountAuthSnapshot) => boolean | Promise<boolean>
  onUnauthorized?: (accountId: string) => void
  reconnectDelaysMs?: number[]
  url: string
}
type RealtimeEventHandler = (event: string, payload: unknown) => void
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000]

export class RealtimeClient {
  private readonly auth?: AuthResolver
  private readonly authCheck?: () => boolean | Promise<boolean>
  private readonly createSocket: RealtimeSocketFactory
  private readonly eventListeners = new Set<RealtimeEventHandler>()
  private readonly isCurrent?: (snapshot: AccountAuthSnapshot) => boolean | Promise<boolean>
  private readonly listeners = new Set<() => void>()
  private readonly onUnauthorized?: (accountId: string) => void
  private readonly reconnectDelaysMs: number[]
  private readonly url: string
  private ready = false
  private reconnectAttempt = 0
  private reconnectSequence = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false
  private socket: RealtimeSocket | null = null
  private status: RealtimeConnectionStatus = "disconnected"

  constructor(options: RealtimeClientOptions) {
    this.auth = options.auth
    this.authCheck = options.authCheck
    this.createSocket = options.createSocket ?? createReactNativeRealtimeSocket
    this.isCurrent = options.isCurrent
    this.onUnauthorized = options.onUnauthorized
    this.reconnectDelaysMs = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : DEFAULT_RECONNECT_DELAYS_MS
    this.url = options.url
  }

  connect() {
    this.shouldReconnect = true
    if (this.socket || this.reconnectTimer) return
    void this.openSocket("connecting")
  }

  disconnect() {
    this.shouldReconnect = false
    this.reconnectAttempt = 0
    this.reconnectSequence += 1
    this.clearReconnectTimer()
    const socket = this.socket
    this.socket = null
    this.ready = false
    this.status = "disconnected"
    socket?.close()
    this.notify()
  }

  getSnapshot(): RealtimeSnapshot { return { ready: this.ready, status: this.status } }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  subscribeEvent(handler: RealtimeEventHandler) { this.eventListeners.add(handler); return () => this.eventListeners.delete(handler) }

  private async openSocket(status: RealtimeConnectionStatus) {
    this.clearReconnectTimer()
    const sequence = ++this.reconnectSequence
    this.ready = false
    this.status = status
    this.notify()
    let snapshot: AccountAuthSnapshot | undefined
    try {
      snapshot = this.auth ? Object.freeze({ ...(await this.auth()) }) : undefined
      if (snapshot && this.isCurrent && !(await this.isCurrent(snapshot))) return
      if (!this.shouldReconnect || sequence !== this.reconnectSequence || this.socket) return
      const socket = this.createSocket(this.url, undefined, {
        headers: { Authorization: snapshot ? `Bearer ${snapshot.token}` : "" },
      })
      this.socket = socket
      socket.onopen = () => {
        if (this.socket !== socket) return
        this.status = "connected"
        this.notify()
      }
      socket.onmessage = (event) => { if (this.socket === socket) this.handleMessage(event.data) }
      socket.onerror = () => undefined
      socket.onclose = (event) => { void this.handleSocketClose(socket, snapshot, event?.code) }
    } catch {
      if (!this.shouldReconnect || sequence !== this.reconnectSequence) return
      this.status = "reconnecting"
      this.notify()
      this.scheduleReconnect()
    }
  }

  private handleMessage(data: unknown) {
    const envelope = parseRealtimeEnvelope(data)
    if (!envelope || envelope.kind !== "event" || !envelope.event) return
    if (envelope.event === realtimeEvents.systemReady) {
      this.ready = true
      this.reconnectAttempt = 0
      this.notify()
    }
    for (const listener of this.eventListeners) listener(envelope.event, envelope.payload)
  }

  private async handleSocketClose(socket: RealtimeSocket, snapshot: AccountAuthSnapshot | undefined, code: number | undefined) {
    if (this.socket !== socket) return
    this.socket = null
    this.ready = false
    if (!this.shouldReconnect) { this.status = "disconnected"; this.notify(); return }
    const reconnectSequence = ++this.reconnectSequence
    this.status = "reconnecting"
    this.notify()
    if (snapshot && this.isCurrent && !(await this.isCurrent(snapshot))) return
    const explicitlyUnauthorized =
      code === 401 || code === 4001 || code === 4401
    const authorized = explicitlyUnauthorized ? false : await this.checkReconnectAuthorization()
    if (reconnectSequence !== this.reconnectSequence || !this.shouldReconnect || this.socket) return
    if (!authorized) {
      this.shouldReconnect = false
      this.status = "disconnected"
      this.notify()
      if (snapshot) this.onUnauthorized?.(snapshot.accountId)
      return
    }
    this.scheduleReconnect()
  }

  private async checkReconnectAuthorization() {
    if (!this.authCheck) return true
    try { return await this.authCheck() }
    catch { return true }
  }

  private scheduleReconnect() {
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? DEFAULT_RECONNECT_DELAYS_MS.at(-1)!
    this.reconnectAttempt += 1
    const sequence = this.reconnectSequence
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect && sequence === this.reconnectSequence) void this.openSocket("connecting")
    }, delay)
  }
  private clearReconnectTimer() { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  private notify() { for (const listener of this.listeners) listener() }
}

export function createReactNativeRealtimeSocket(
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: { Authorization: string } }
): RealtimeSocket {
  const Constructor = WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
    options?: { headers: Record<string, string> }
  ) => WebSocket
  return new Constructor(url, protocols, options)
}

export function buildRealtimeWebSocketUrl(serverUrl: string, development = false) {
  assertSecureTransport(serverUrl, development)
  const url = new URL("api/client/ws", `${serverUrl.replace(/\/+$/, "")}/`)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  assertSecureTransport(url.toString(), development)
  return url.toString()
}
