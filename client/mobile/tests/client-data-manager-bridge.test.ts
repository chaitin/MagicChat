import assert from "node:assert/strict"
import test from "node:test"

import { startManagerQueryBridge, type BridgeState } from "@/providers/client-data/manager-query-bridge"
import { startManagerPolling } from "@/providers/client-data/use-manager-polling"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("fake manager mirrors initial snapshot and subscribed events into Query", async () => {
  let listener: ((value: number) => void) | undefined; let unsubscribed = 0
  const writes: number[] = []; const states: BridgeState<number>[] = []
  const stop = startManagerQueryBridge({ generation: 1, getSnapshot: async () => 1,
    queryClient: { setQueryData: (_key, value) => { writes.push(value as number); return value } },
    project: (queryClient, value) => { queryClient.setQueryData(["fake"], value) },
    subscribe: (next) => { listener = next; return () => { unsubscribed++ } }, onState: (state) => states.push(state),
  })
  await tick(); listener?.(2)
  assert.deepEqual(writes, [1, 2]); assert.equal(states.at(-1)?.data, 2)
  stop(); assert.equal(unsubscribed, 1)
})

test("target generation discards stale snapshot and unsubscribes old target", async () => {
  let resolveOld!: (value: string) => void; let oldListener!: (value: string) => void; let oldUnsubscribed = 0; let currentGeneration = 1
  const visible: string[] = []; const projected: string[] = []; const onState = (state: BridgeState<string>, generation: number) => { if (generation === currentGeneration && state.data) visible.push(state.data) }
  const stopOld = startManagerQueryBridge({ generation: 1, getSnapshot: () => new Promise((resolve) => { resolveOld = resolve }),
    queryClient: { setQueryData: () => undefined }, project: (_query, value) => { projected.push(value) }, subscribe: (listener) => { oldListener = listener; return () => { oldUnsubscribed++ } }, onState })
  currentGeneration = 2; stopOld()
  const stopNew = startManagerQueryBridge({ generation: 2, getSnapshot: async () => "new", queryClient: { setQueryData: () => undefined }, project: () => undefined, subscribe: () => () => undefined, onState })
  resolveOld("old"); oldListener("old-event"); await tick()
  assert.deepEqual(visible, ["new"]); assert.deepEqual(projected, []); assert.equal(oldUnsubscribed, 1); stopNew()
})

test("bridge error is replaced by a successful manager event", async () => {
  let listener!: (value: string) => void; const states: BridgeState<string>[] = []
  const stop = startManagerQueryBridge({ generation: 1, getSnapshot: async () => { throw new Error("offline") }, queryClient: { setQueryData: () => undefined }, project: () => undefined, subscribe: (next) => { listener = next; return () => undefined }, onState: (state) => states.push(state) })
  await tick(); assert.equal(states.at(-1)?.error?.message, "offline")
  listener("recovered"); assert.equal(states.at(-1)?.error, null); assert.equal(states.at(-1)?.data, "recovered"); stop()
})

test("polling cleanup aborts active generation and clears future ticks", async () => {
  let calls = 0; let signal: AbortSignal | undefined
  const stop = startManagerPolling(5, async (nextSignal) => { calls++; signal = nextSignal }, () => true)
  await new Promise((resolve) => setTimeout(resolve, 18)); assert.ok(calls >= 2)
  stop(); const stoppedAt = calls; assert.equal(signal?.aborted, true)
  await new Promise((resolve) => setTimeout(resolve, 15)); assert.equal(calls, stoppedAt)
})
