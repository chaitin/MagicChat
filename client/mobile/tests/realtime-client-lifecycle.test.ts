import assert from "node:assert/strict"
import test from "node:test"

import { waitForClientReady } from "../src/realtime/realtime-connection.ts"
import { RealtimeClient } from "../src/realtime/realtime-client.ts"

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const readyEvent = JSON.stringify({ v: 1, kind: "event", event: "system.ready" })

test("disconnect cancels an authorization-delayed reconnect and a later connect recovers", async () => {
  const sockets: MockSocket[] = []
  let releaseAuth!: (authorized: boolean) => void
  const auth = new Promise<boolean>((resolve) => { releaseAuth = resolve })
  const client = new RealtimeClient({
    authCheck: () => auth,
    createSocket: () => { const socket = new MockSocket(); sockets.push(socket); return socket },
    reconnectDelaysMs: [0],
    url: "wss://example.test/ws",
  })

  client.connect()
  sockets[0]!.closeFromServer()
  client.disconnect()
  releaseAuth(true)
  await tick(); await tick()
  assert.equal(sockets.length, 1, "stale reconnect must not create a socket")
  assert.deepEqual(client.getSnapshot(), { ready: false, status: "disconnected" })

  client.connect()
  assert.equal(sockets.length, 2)
  sockets[1]!.open()
  sockets[1]!.message(readyEvent)
  assert.deepEqual(client.getSnapshot(), { ready: true, status: "connected" })
})

test("ready wait releases its subscription on disconnect timeout and later connection can become ready", async () => {
  const sockets: MockSocket[] = []
  const client = new RealtimeClient({
    createSocket: () => { const socket = new MockSocket(); sockets.push(socket); return socket },
    url: "wss://example.test/ws",
  })
  let notifications = 0
  const unsubscribe = client.subscribe(() => { notifications += 1 })

  client.connect()
  const staleWait = waitForClientReady(client, 5)
  client.disconnect()
  await assert.rejects(staleWait, /实时连接超时/)
  const afterTimeout = notifications

  client.connect()
  sockets.at(-1)!.open()
  const recovered = waitForClientReady(client, 100)
  sockets.at(-1)!.message(readyEvent)
  await recovered
  assert.equal(client.getSnapshot().ready, true)
  assert.ok(notifications > afterTimeout)
  unsubscribe()
})

class MockSocket {
  readyState = 0
  onclose: ((event?: unknown) => void) | null = null
  onerror: ((event?: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: ((event?: unknown) => void) | null = null
  close() { this.readyState = 3 }
  closeFromServer() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  message(data: unknown) { this.onmessage?.({ data }) }
}
