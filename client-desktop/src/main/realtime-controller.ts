import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import { HttpsProxyAgent } from "https-proxy-agent"
import tls from "node:tls"
import {
  CLIENT_PROTOCOL_VERSION,
  targetKey,
  type AuthenticatedTarget,
  type RealtimeEnvelope,
  type RealtimeSnapshot,
} from "@shared/client-contract"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"
import type { ProxyAuthPrompt } from "@main/proxy-auth"
import type { DiagnosticRecord, Diagnostics } from "@main/diagnostics"
import {
  createDiagnosticEventInput,
  type DiagnosticDataForType,
  type DiagnosticType,
} from "@shared/diagnostics-contract"

type Connection = {
  attempt: number
  connectionInstanceId: string
  episodeId: string
  hasOpenedSocket: boolean
  intentionallyClosed: boolean
  pending: Map<
    string,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >
  ready: boolean
  parseFailureWindow?: ParseFailureWindow
  preserveEpisodeForSocket?: WebSocket
  stateRevision: number
  systemReadyCount: number
  socket?: WebSocket
  status: RealtimeSnapshot["status"]
  target: AuthenticatedTarget
  timer?: NodeJS.Timeout
}

type ParseFailureWindow = {
  firstEventSeq: Promise<number | undefined>
  startedAt: string
  suppressedCount: number
  timer?: NodeJS.Timeout
}

const delays = [500, 1_000, 2_000, 5_000, 10_000, 30_000]

export class RealtimeController extends EventEmitter {
  private readonly connections = new Map<string, Connection>()
  private readonly stateRevisions = new Map<string, number>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
    private readonly proxyAuth?: ProxyAuthPrompt,
    private readonly diagnostics?: Diagnostics,
  ) {
    super()
  }

  async connect(target: AuthenticatedTarget): Promise<RealtimeSnapshot> {
    const key = targetKey(target)
    let connection = this.connections.get(key)
    if (!connection) {
      const profile = this.profiles.require(target.id)
      if (profile.normalizedUrl !== target.normalizedUrl) throw new Error("认证目标已失效")
      connection = {
        attempt: 0,
        connectionInstanceId: diagnosticId(),
        episodeId: this.diagnostics?.getCurrentEpisodeId() ?? this.createEpisode("connection"),
        hasOpenedSocket: false,
        intentionallyClosed: false,
        pending: new Map(),
        ready: false,
        stateRevision: this.stateRevisions.get(key) ?? 0,
        status: "connecting",
        systemReadyCount: 0,
        target,
      }
      this.connections.set(key, connection)
      void this.record(connection, "realtime.connection-created", {
        ready: false,
        status: "connecting",
      })
      await this.open(connection)
    }
    return this.snapshot(connection)
  }

  close(target: AuthenticatedTarget): void {
    const key = targetKey(target)
    const connection = this.connections.get(key)
    if (!connection) return
    connection.intentionallyClosed = true
    if (connection.timer) clearTimeout(connection.timer)
    const socket = connection.socket
    const previousReady = connection.ready
    const previousStatus = connection.status
    connection.ready = false
    connection.status = "disconnected"
    if (socket)
      void this.record(connection, "realtime.socket-closed", {
        closeCode: 1000,
        closeReasonLength: "target closed".length,
        previousReady,
        previousStatus,
        reason: "manual",
        ready: false,
        status: "disconnected",
      })
    this.rejectPending(connection, new Error("实时连接已关闭"))
    this.emitStateSnapshot(connection, previousStatus, previousReady)
    this.connections.delete(key)
    socket?.close(1000, "target closed")
  }

  closeServer(serverId: string): void {
    for (const connection of this.connections.values())
      if (connection.target.id === serverId) this.close(connection.target)
  }

  closeAll(): void {
    for (const connection of [...this.connections.values()]) this.close(connection.target)
  }

  reconnectAll(episodeId?: string): void {
    for (const connection of this.connections.values()) {
      if (connection.intentionallyClosed) continue
      connection.episodeId = episodeId ?? this.createEpisode("reconnect")
      const socket = connection.socket
      if (socket) {
        connection.preserveEpisodeForSocket = socket
        socket.terminate()
      } else void this.open(connection)
    }
  }

  async send(target: AuthenticatedTarget, method: string, payload: unknown): Promise<unknown> {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(method)) throw new Error("实时方法无效")
    const connection = this.connections.get(targetKey(target))
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN || !connection.ready)
      throw new Error("实时连接尚未就绪")
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id)
        reject(new Error("实时请求超时"))
      }, 30_000)
      connection.pending.set(id, { reject, resolve, timer })
      connection.socket!.send(
        JSON.stringify({ v: CLIENT_PROTOCOL_VERSION, kind: "request", id, method, payload }),
      )
    })
  }

  snapshot(connection: Connection): RealtimeSnapshot {
    return {
      connectionInstanceId: connection.connectionInstanceId,
      episodeId: connection.episodeId,
      ready: connection.ready,
      stateRevision: connection.stateRevision,
      status: connection.status,
      targetKey: targetKey(connection.target),
      targetScope: connection.target.id,
    }
  }

  private async open(connection: Connection): Promise<void> {
    if (
      connection.intentionallyClosed ||
      !this.isCurrentConnection(connection) ||
      connection.socket
    )
      return
    const profile = this.profiles.require(connection.target.id)
    const cookies = await this.sessions.for(profile).cookies.get({ url: profile.normalizedUrl })
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
    const wsUrl = new URL("/api/client/ws", `${profile.normalizedUrl}/`)
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
    const proxy = await resolveProxy(this.sessions.for(profile), wsUrl)
    const agent = proxy
      ? new HttpsProxyAgent(
          withProxyCredentials(proxy, this.proxyAuth?.getCredentials(new URL(proxy).hostname)),
        )
      : undefined
    if (
      connection.intentionallyClosed ||
      !this.isCurrentConnection(connection) ||
      connection.socket
    )
      return
    if (connection.hasOpenedSocket) connection.connectionInstanceId = diagnosticId()
    const previousStatus = connection.status
    connection.status = connection.attempt === 0 ? "connecting" : "reconnecting"
    this.emitStateSnapshot(connection, previousStatus, connection.ready)
    const socket = new WebSocket(wsUrl, {
      agent,
      ca: systemCertificateAuthorities(),
      headers: { Cookie: cookieHeader, Origin: profile.normalizedUrl },
      perMessageDeflate: false,
      rejectUnauthorized: true,
    })
    connection.socket = socket
    connection.hasOpenedSocket = true
    socket.on("open", () => {
      if (!this.isCurrentConnection(connection) || connection.socket !== socket) return
      const previousStatus = connection.status
      connection.attempt = 0
      connection.status = "connected"
      void this.record(connection, "realtime.socket-opened", {
        previousStatus,
        ready: connection.ready,
        status: connection.status,
      })
      this.emitStateSnapshot(connection, previousStatus, connection.ready)
    })
    socket.on("ping", (data) => {
      if (this.isCurrentConnection(connection) && connection.socket === socket) socket.pong(data)
    })
    socket.on("message", (data, binary) => {
      if (!this.isCurrentConnection(connection) || connection.socket !== socket) return
      const size = Array.isArray(data)
        ? data.reduce((total, item) => total + item.byteLength, 0)
        : data.byteLength
      if (binary || size > 2 * 1024 * 1024) return socket.close(1009, "message too large")
      this.handleMessage(connection, data.toString())
    })
    socket.on("error", () => undefined)
    socket.on("close", (closeCode, reason) => {
      const isCurrentSocket = this.isCurrentConnection(connection) && connection.socket === socket
      if (connection.socket === socket) connection.socket = undefined
      if (!isCurrentSocket) return
      void this.flushParseFailures(connection)
      const preservesEpisode = connection.preserveEpisodeForSocket === socket
      if (preservesEpisode) connection.preserveEpisodeForSocket = undefined
      if (!connection.intentionallyClosed && !preservesEpisode)
        connection.episodeId = this.createEpisode("reconnect")
      const previousStatus = connection.status
      const previousReady = connection.ready
      connection.ready = false
      connection.status = connection.intentionallyClosed ? "disconnected" : "reconnecting"
      void this.record(connection, "realtime.socket-closed", {
        closeCode: Math.max(0, Math.min(9_999, closeCode)),
        closeReasonLength: Math.min(256, reason.byteLength),
        previousReady,
        previousStatus,
        reason: connection.intentionallyClosed ? "manual" : classifyCloseReason(reason),
        ready: false,
        status: connection.status,
      })
      this.rejectPending(connection, new Error("实时连接已断开"))
      this.emitStateSnapshot(connection, previousStatus, previousReady)
      if (connection.intentionallyClosed) return
      void this.checkAuthorizedAndSchedule(connection)
    })
  }

  private handleMessage(connection: Connection, raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.recordParseFailure(connection)
      return
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.recordParseFailure(connection)
      return
    }
    const envelope = parsed as RealtimeEnvelope
    if (envelope.v !== CLIENT_PROTOCOL_VERSION) {
      this.recordParseFailure(connection)
      return
    }
    if (envelope.kind === "event") {
      const previousReady = connection.ready
      if (envelope.event === "system.ready") {
        connection.ready = true
        connection.systemReadyCount += 1
        void this.record(connection, "realtime.system-ready", {
          previousReady,
          ready: true,
          status: connection.status,
          systemReadyCount: connection.systemReadyCount,
        })
      }
      const targeted = { ...envelope, targetKey: targetKey(connection.target) }
      this.emit("envelope", targeted)
      if (envelope.event === "system.ready" && !previousReady)
        this.emitStateSnapshot(connection, connection.status, previousReady)
      return
    }
    if (envelope.kind === "response" && envelope.reply_to) {
      const pending = connection.pending.get(envelope.reply_to)
      if (!pending) return
      clearTimeout(pending.timer)
      connection.pending.delete(envelope.reply_to)
      if (envelope.ok) pending.resolve(envelope.payload)
      else pending.reject(new Error(envelope.error?.message ?? "实时请求失败"))
    }
  }

  private async checkAuthorizedAndSchedule(connection: Connection): Promise<void> {
    if (!this.isCurrentConnection(connection)) return
    const profile = this.profiles.require(connection.target.id)
    try {
      const response = await this.sessions
        .for(profile)
        .fetch(`${profile.normalizedUrl}/api/client/me`, { credentials: "include" })
      if (!this.isCurrentConnection(connection)) return
      void this.record(connection, "realtime.authorization-checked", {
        responseStatus: Math.max(0, Math.min(999, response.status)),
      })
      if (response.status === 401) {
        connection.intentionallyClosed = true
        connection.status = "disconnected"
        this.emit("unauthorized", connection.target)
        this.emitStateSnapshot(connection, "reconnecting", false)
        return
      }
    } catch {
      if (!this.isCurrentConnection(connection)) return
      // 离线和服务器重启时仍进入有上限退避，不将网络失败误判为退出登录。
      void this.record(connection, "realtime.authorization-checked", {
        error: { category: "network", phase: "authorization" },
      })
    }
    const delay = delays[Math.min(connection.attempt++, delays.length - 1)]
    void this.record(connection, "realtime.reconnect-scheduled", {
      attempt: connection.attempt,
      durationMs: delay,
    })
    connection.timer = setTimeout(() => {
      connection.timer = undefined
      if (!this.isCurrentConnection(connection)) return
      void this.open(connection)
    }, delay)
  }

  private rejectPending(connection: Connection, error: Error): void {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    connection.pending.clear()
  }

  private emitStateSnapshot(
    connection: Connection,
    previousStatus: RealtimeSnapshot["status"],
    previousReady: boolean,
  ): void {
    if (previousReady !== connection.ready || previousStatus !== connection.status)
      void this.record(connection, "realtime.state-changed", {
        previousReady,
        previousStatus,
        ready: connection.ready,
        status: connection.status,
      })
    const key = targetKey(connection.target)
    connection.stateRevision =
      Math.max(connection.stateRevision, this.stateRevisions.get(key) ?? 0) + 1
    this.stateRevisions.set(key, connection.stateRevision)
    this.emit("snapshot", this.snapshot(connection))
  }

  private isCurrentConnection(connection: Connection): boolean {
    return this.connections.get(targetKey(connection.target)) === connection
  }

  private record<Type extends Extract<DiagnosticType, `realtime.${string}`>>(
    connection: Connection,
    type: Type,
    ...[data]: Type extends "realtime.state-changed"
      ? [data: DiagnosticDataForType<Type>]
      : [data?: DiagnosticDataForType<Type>]
  ): Promise<DiagnosticRecord | undefined> {
    if (!this.diagnostics) return Promise.resolve(undefined)
    return this.diagnostics.recordEvent(
      createDiagnosticEventInput(
        type,
        "main",
        {
          connectionInstanceId: connection.connectionInstanceId,
          episodeId: connection.episodeId,
          targetScope: connection.target.id,
        },
        data,
      ),
    )
  }

  private recordParseFailure(connection: Connection): void {
    if (!connection.parseFailureWindow) {
      const startedAt = new Date().toISOString()
      const firstEvent = this.record(connection, "realtime.event-parse-failed", {
        error: { category: "parse" },
      })
      connection.parseFailureWindow = {
        firstEventSeq: firstEvent.then((event) => event?.eventSeq),
        startedAt,
        suppressedCount: 0,
      }
      connection.parseFailureWindow.timer = setTimeout(() => {
        void this.flushParseFailures(connection)
      }, 30_000)
      connection.parseFailureWindow.timer.unref?.()
      return
    }

    connection.parseFailureWindow.suppressedCount += 1
  }

  private async flushParseFailures(connection: Connection): Promise<void> {
    const current = connection.parseFailureWindow
    connection.parseFailureWindow = undefined
    if (!current) return
    if (current.timer) clearTimeout(current.timer)
    if (current.suppressedCount === 0) return
    const firstEventSeq = await current.firstEventSeq
    await this.record(connection, "realtime.parse-failures-aggregated", {
      suppressedCount: current.suppressedCount,
      suppressedFromEventSeq: firstEventSeq ?? 0,
      suppressedToEventSeq: 0,
      windowEndedAt: new Date().toISOString(),
      windowStartedAt: current.startedAt,
    })
  }

  private createEpisode(reason: import("@main/diagnostics").DiagnosticEpisodeReason): string {
    return this.diagnostics?.createEpisode(reason) ?? diagnosticId()
  }
}

function diagnosticId(): string {
  return randomUUID().replace(/-/g, "")
}

function classifyCloseReason(reason: Buffer): "authorization" | "network" | "unknown" {
  if (reason.byteLength === 0) return "unknown"
  const value = reason.toString("utf8", 0, 64).toLowerCase()
  if (value.includes("auth") || value.includes("unauthor")) return "authorization"
  return "network"
}

export async function resolveProxy(
  networkSession: import("electron").Session,
  target: URL,
): Promise<string | undefined> {
  const value = await networkSession.resolveProxy(target.toString())
  const first = value.split(";")[0]?.trim()
  if (!first || first === "DIRECT") return undefined
  const [kind, address] = first.split(/\s+/, 2)
  if (!address || (kind !== "PROXY" && kind !== "HTTPS")) return undefined
  return `${kind === "HTTPS" ? "https" : "http"}://${address}`
}

export function withProxyCredentials(
  proxy: string,
  credentials?: { password: string; username: string },
): string {
  if (!credentials) return proxy
  const url = new URL(proxy)
  url.username = credentials.username
  url.password = credentials.password
  return url.toString()
}

export function systemCertificateAuthorities(): string[] | undefined {
  const getCertificates = (tls as typeof tls & { getCACertificates?: (type: "system") => string[] })
    .getCACertificates
  const certificates = getCertificates?.("system")
  return certificates?.length ? [...tls.rootCertificates, ...certificates] : undefined
}
