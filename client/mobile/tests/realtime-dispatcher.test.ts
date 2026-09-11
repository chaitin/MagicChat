import assert from "node:assert/strict"
import test from "node:test"

import {
  createRealtimeTargetKey,
  waitForClientReady,
  waitForRealtimeClient,
  type ReadyRealtimeClient,
} from "../src/realtime/realtime-connection.ts"
import { RealtimeDispatcher } from "../src/realtime/realtime-dispatcher.ts"

test("dispatcher runs event tasks strictly in order", async () => {
  const dispatcher = new RealtimeDispatcher()
  const target = dispatcher.activate(assert.fail)
  const events: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))

  target.enqueue(async () => {
    events.push("first:start")
    await blocked
    events.push("first:end")
  })
  target.enqueue(() => events.push("second"))
  await tick()
  assert.deepEqual(events, ["first:start"])
  release()
  await tick()
  assert.deepEqual(events, ["first:start", "first:end", "second"])
})

test("dispatcher drops queued projection work after target disposal", async () => {
  const dispatcher = new RealtimeDispatcher()
  const oldTarget = dispatcher.activate(assert.fail)
  const events: string[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))

  oldTarget.enqueue(() => blocked)
  oldTarget.enqueue(() => events.push("stale"))
  await tick()
  oldTarget.dispose()
  const newTarget = dispatcher.activate(assert.fail)
  newTarget.enqueue(() => events.push("current"))
  release()
  await tick()
  await tick()
  assert.deepEqual(events, ["current"])
})

test("connection helpers preserve target identity and ready waiting", async () => {
  const client = new MockClient()
  const target = { id: "server", url: "https://example.test", userId: "user" }
  const ref = { current: null as { client: MockClient; targetKey: string } | null }
  const waitingClient = waitForRealtimeClient(
    ref,
    createRealtimeTargetKey(target),
    100
  )
  setTimeout(() => {
    ref.current = { client, targetKey: createRealtimeTargetKey(target) }
  }, 5)
  assert.equal(await waitingClient, client)

  const ready = waitForClientReady(client, 100)
  client.markReady()
  await ready
  assert.equal(client.listenerCount, 0)
})

test("ready waiting retains timeout error", async () => {
  await assert.rejects(waitForClientReady(new MockClient(), 1), /实时连接超时/)
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

class MockClient implements ReadyRealtimeClient {
  private listeners = new Set<() => void>()
  private ready = false
  get listenerCount() {
    return this.listeners.size
  }
  connect() {}
  disconnect() {}
  getSnapshot() {
    return { ready: this.ready }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  markReady() {
    this.ready = true
    for (const listener of this.listeners) listener()
  }
}
