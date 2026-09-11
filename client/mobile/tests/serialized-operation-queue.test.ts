import assert from "node:assert/strict"
import test from "node:test"

import { SerializedOperationQueue } from "@/notifications/serialized-operation-queue"

test("serialized operation queue preserves order and survives failures", async () => {
  const queue = new SerializedOperationQueue()
  const calls: string[] = []
  const first = queue.run(async () => {
    calls.push("first:start")
    await Promise.resolve()
    calls.push("first:end")
    throw new Error("first failed")
  })
  const second = queue.run(async () => {
    calls.push("second")
    return 2
  })
  await assert.rejects(first, /first failed/)
  assert.equal(await second, 2)
  assert.deepEqual(calls, ["first:start", "first:end", "second"])
})

test("separate serialized operation queues do not block each other", async () => {
  const firstQueue = new SerializedOperationQueue()
  const secondQueue = new SerializedOperationQueue()
  let releaseFirst: (() => void) | undefined
  const first = firstQueue.run(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
  )
  const second = secondQueue.run(async () => "ready")
  assert.equal(await second, "ready")
  releaseFirst?.()
  await first
})
