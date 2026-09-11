import assert from "node:assert/strict"
import test from "node:test"

import { buildRealtimeWebSocketUrl, createReactNativeRealtimeSocket, RealtimeClient } from "@/realtime/realtime-client"
import { RealtimeClientSlot } from "@/realtime/realtime-runtime"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const ready = JSON.stringify({ v: 1, kind: "event", event: "system.ready" })

class MockSocket {
  closeCalls = 0
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  close() { this.closeCalls++; this.readyState = 3 }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
  message(data: string) { this.onmessage?.({ data }) }
}

test("RN socket factory passes Bearer only in native headers", () => {
  const original = globalThis.WebSocket
  let captured: unknown[] = []
  class CapturingSocket { constructor(...args: unknown[]) { captured = args } }
  globalThis.WebSocket = CapturingSocket as unknown as typeof WebSocket
  try {
    createReactNativeRealtimeSocket("wss://chat.example/api/client/ws", undefined, { headers: { Authorization: "Bearer secret-token" } })
    assert.equal(captured[0], "wss://chat.example/api/client/ws")
    assert.equal(captured[1], undefined)
    assert.deepEqual(captured[2], { headers: { Authorization: "Bearer secret-token" } })
    assert.equal(String(captured[0]).includes("secret-token"), false)
  } finally { globalThis.WebSocket = original }
})

test("realtime URL enforces WSS and explicit loopback development exception", () => {
  assert.equal(buildRealtimeWebSocketUrl("https://chat.example/base"), "wss://chat.example/base/api/client/ws")
  assert.equal(buildRealtimeWebSocketUrl("http://127.0.0.1:8080", true), "ws://127.0.0.1:8080/api/client/ws")
  assert.throws(() => buildRealtimeWebSocketUrl("http://127.0.0.1:8080"), /HTTPS\/WSS/)
  assert.throws(() => buildRealtimeWebSocketUrl("ws://remote.example", true), /HTTPS\/WSS/)
})

test("every connect resolves immutable account credential and never puts token in URL/state", async () => {
  const sockets: MockSocket[] = []
  const generations: number[] = []
  const client = new RealtimeClient({
    url: "wss://chat.example/ws",
    auth: async () => ({ accountId: "A", generation: 2, token: "secret-token" }),
    isCurrent: (snapshot) => { generations.push(snapshot.generation); return true },
    createSocket: (url, _protocols, options) => {
      assert.equal(url.includes("secret-token"), false)
      assert.equal(options.headers.Authorization, "Bearer secret-token")
      const socket = new MockSocket(); sockets.push(socket); return socket as unknown as WebSocket
    },
    reconnectDelaysMs: [0],
  })
  client.connect(); await tick()
  assert.deepEqual(client.getSnapshot(), { ready: false, status: "connecting" })
  sockets[0]!.serverClose(); await tick(); await tick()
  assert.equal(sockets.length, 2)
  assert.deepEqual(generations, [2, 2, 2])
  assert.equal(JSON.stringify(client.getSnapshot()).includes("secret-token"), false)
  client.disconnect()
})

test("slot disconnects old account before installing one new connection", () => {
  const slot = new RealtimeClientSlot()
  const a = { disconnectCalls: 0, disconnect() { this.disconnectCalls++ } }
  const b = { disconnectCalls: 0, disconnect() { this.disconnectCalls++ } }
  slot.replace(a as unknown as RealtimeClient, { accountId: "A", generation: 1 })
  slot.replace(b as unknown as RealtimeClient, { accountId: "B", generation: 2 })
  assert.equal(a.disconnectCalls, 1)
  assert.equal(b.disconnectCalls, 0)
  assert.equal(slot.isCurrent({ accountId: "A", generation: 1 }), false)
  assert.equal(slot.isCurrent({ accountId: "B", generation: 2 }), true)
  slot.clear(a as unknown as RealtimeClient)
  assert.equal(b.disconnectCalls, 0, "old cleanup must not disconnect B")
})

test("old close/event and reconnect sequence cannot affect replacement account", async () => {
  const oldSocket = new MockSocket()
  const events: string[] = []
  const client = new RealtimeClient({ url: "wss://chat.example/ws", createSocket: () => oldSocket as unknown as WebSocket, reconnectDelaysMs: [0] })
  client.subscribeEvent((event) => events.push(event))
  client.connect(); await tick()
  client.disconnect()
  oldSocket.message(ready)
  oldSocket.serverClose()
  await tick(); await tick()
  assert.deepEqual(events, [])
  assert.deepEqual(client.getSnapshot(), { ready: false, status: "disconnected" })
})

test("WS unauthorized close marks only captured account", async () => {
  for (const closeCode of [401, 4001, 4401]) {
    const socket = new MockSocket()
    const marked: string[] = []
    const client = new RealtimeClient({
      url: "wss://chat.example/ws",
      auth: async () => ({
        accountId: "A",
        generation: 4,
        token: "do-not-log",
      }),
      isCurrent: (snapshot) =>
        snapshot.accountId === "A" && snapshot.generation === 4,
      createSocket: () => socket as unknown as WebSocket,
      onUnauthorized: (accountId) => marked.push(accountId),
    })
    client.connect()
    await tick()
    socket.serverClose(closeCode)
    await tick()
    assert.deepEqual(marked, ["A"])
    assert.equal(
      JSON.stringify(client.getSnapshot()).includes("do-not-log"),
      false
    )
  }
})
