import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  RealtimeClient,
  type RealtimeTransportState,
  type RealtimeWebSocketLike,
} from "@/lib/realtime-client"
import type { DiagnosticContext } from "@shared/diagnostics-contract"

class FakeWebSocket implements RealtimeWebSocketLike {
  static instances: FakeWebSocket[] = []

  diagnosticContext?: () => DiagnosticContext | undefined
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  ontransportstatechange: ((state: RealtimeTransportState) => void) | null = null
  transportStateIsAuthoritative = false
  readyState: number = WebSocket.CONNECTING
  sent: string[] = []
  throwOnSend = false
  url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close", { code: 1000 }))
  }

  send(data: string) {
    if (this.throwOnSend) {
      throw new Error("send failed")
    }
    this.sent.push(data)
  }

  open() {
    this.readyState = WebSocket.OPEN
    this.onopen?.(new Event("open"))
  }

  receive(payload: unknown) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    )
  }

  receiveTransportState(state: RealtimeTransportState) {
    this.ontransportstatechange?.(state)
  }

  failClose(code = 1006) {
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent("close", { code }))
  }
}

function createClient() {
  return new RealtimeClient({
    createWebSocket: (url) => new FakeWebSocket(url),
    reconnectDelaysMs: [100],
    url: "ws://example.test/api/client/ws",
  })
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("RealtimeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("dispatches subscribed realtime events and stops after unsubscribe", () => {
    const client = createClient()
    const handler = vi.fn()
    const unsubscribe = client.subscribeEvent("message.created", handler)

    client.connect()
    FakeWebSocket.instances[0].open()
    FakeWebSocket.instances[0].receive({
      v: 1,
      kind: "event",
      event: "message.created",
      payload: {
        message: {
          id: "message-13",
        },
      },
    })

    expect(handler).toHaveBeenCalledWith({
      message: {
        id: "message-13",
      },
    })

    unsubscribe()
    FakeWebSocket.instances[0].receive({
      v: 1,
      kind: "event",
      event: "message.created",
      payload: {
        message: {
          id: "message-14",
        },
      },
    })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("marks the realtime connection ready only after system.ready", () => {
    const client = createClient()
    const readyHandler = vi.fn()
    client.subscribeEvent("system.ready", readyHandler)
    client.connect()
    FakeWebSocket.instances[0].open()

    expect(client.getSnapshot().status).toBe("connected")
    expect(client.getSnapshot().ready).toBe(false)

    FakeWebSocket.instances[0].receive({
      v: 1,
      kind: "event",
      event: "system.ready",
      payload: {},
    })
    expect(client.getSnapshot().ready).toBe(true)
    expect(readyHandler).toHaveBeenCalledOnce()

    FakeWebSocket.instances[0].failClose()
    expect(client.getSnapshot().ready).toBe(false)
  })

  it("镜像 Desktop 传输断线状态，但不启动 Renderer 重连", async () => {
    const client = createClient()
    client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.receive({ v: 1, kind: "event", event: "system.ready", payload: {} })
    const pending = client.sendRequest("message.create", { text: "hello" })

    socket.receiveTransportState({ ready: false, status: "reconnecting" })

    expect(client.getSnapshot()).toEqual({ ready: false, status: "reconnecting" })
    await expect(pending).rejects.toThrow("实时连接已断开")
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.instances).toHaveLength(1)

    socket.receive({ v: 1, kind: "event", event: "system.ready", payload: {} })
    expect(client.getSnapshot()).toEqual({ ready: true, status: "reconnecting" })
  })

  it("权威传输的虚拟 open 不覆盖 Main 状态", () => {
    const client = createClient()
    client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.transportStateIsAuthoritative = true
    socket.receiveTransportState({ ready: false, status: "reconnecting" })

    socket.open()

    expect(client.getSnapshot()).toEqual({ ready: false, status: "reconnecting" })
  })

  it("sends request envelopes and resolves matching responses", async () => {
    const client = createClient()
    client.connect()
    FakeWebSocket.instances[0].open()

    const result = client.sendRequest("message.create", { text: "hello" })
    const sent = JSON.parse(FakeWebSocket.instances[0].sent[0])

    expect(sent).toMatchObject({
      kind: "request",
      method: "message.create",
      payload: { text: "hello" },
      v: 1,
    })
    expect(sent.id).toEqual(expect.any(String))

    FakeWebSocket.instances[0].receive({
      v: 1,
      kind: "response",
      reply_to: sent.id,
      ok: true,
      payload: {
        accepted: true,
      },
    })

    await expect(result).resolves.toEqual({ accepted: true })
  })

  it("rejects pending requests when the socket closes before a response", async () => {
    const client = createClient()
    client.connect()
    FakeWebSocket.instances[0].open()

    const result = client.sendRequest("message.create", { text: "hello" })
    let rejectionMessage: string | undefined
    result.catch((error: Error) => {
      rejectionMessage = error.message
    })

    FakeWebSocket.instances[0].failClose()
    await flushPromises()

    expect(rejectionMessage).toBe("实时连接已断开")
  })

  it("stops reconnecting and reports unauthorized when auth check fails", async () => {
    const authCheck = vi.fn().mockResolvedValue(false)
    const onUnauthorized = vi.fn()
    const client = new RealtimeClient({
      authCheck,
      createWebSocket: (url: string) => new FakeWebSocket(url),
      onUnauthorized,
      reconnectDelaysMs: [100],
      url: "ws://example.test/api/client/ws",
    } as ConstructorParameters<typeof RealtimeClient>[0] & {
      authCheck: () => Promise<boolean>
      onUnauthorized: () => void
    })

    client.connect()
    FakeWebSocket.instances[0].open()

    FakeWebSocket.instances[0].failClose()
    await flushPromises()

    expect(authCheck).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().status).toBe("disconnected")

    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("reconnects after abnormal close and stops reconnecting after disconnect", () => {
    const client = createClient()
    client.connect()
    FakeWebSocket.instances[0].open()

    FakeWebSocket.instances[0].failClose()
    expect(client.getSnapshot().status).toBe("reconnecting")

    vi.advanceTimersByTime(100)
    expect(FakeWebSocket.instances).toHaveLength(2)

    client.disconnect()
    FakeWebSocket.instances[1].failClose()
    vi.advanceTimersByTime(100)

    expect(client.getSnapshot().status).toBe("disconnected")
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it("断线和重连日志保留已关闭 socket 的关联上下文", () => {
    const record = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: { diagnostics: { record } },
    })
    const client = createClient()
    client.connect()
    const socket = FakeWebSocket.instances[0]
    socket.diagnosticContext = () => ({
      connectionInstanceId: "connection-1",
      episodeId: "episode-1",
      targetScope: "server-1",
    })
    socket.open()
    record.mockClear()

    socket.failClose()

    const events = record.mock.calls.map(([event]) => event)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          context: {
            connectionInstanceId: "connection-1",
            episodeId: "episode-1",
            targetScope: "server-1",
          },
          data: expect.objectContaining({ status: "reconnecting" }),
          type: "realtime.state-changed",
        }),
        expect.objectContaining({
          context: {
            connectionInstanceId: "connection-1",
            episodeId: "episode-1",
            targetScope: "server-1",
          },
          type: "realtime.reconnect-scheduled",
        }),
      ]),
    )
  })
})
