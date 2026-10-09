import assert from "node:assert/strict"
import test from "node:test"

import { createShortLivedReadCache } from "../src/data/messages/short-lived-read-cache.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("press, first query and mounted screen reuse one local read", async () => {
  const cache = createShortLivedReadCache<number>(1_500)
  const pending = deferred<number>()
  let reads = 0
  const load = () => { reads += 1; return pending.promise }
  const subscribe = () => () => undefined
  const press = cache.read("account:conversation", load, subscribe)
  const query = cache.read("account:conversation", load, subscribe)
  pending.resolve(20)
  assert.equal(await press.promise, 20)
  assert.equal(await query.promise, 20)
  const mounted = cache.read("account:conversation", load, subscribe)
  assert.equal(await mounted.promise, 20)
  assert.equal(query.reused, true)
  assert.equal(mounted.reused, true)
  assert.equal(reads, 1)
  cache.invalidate("account:conversation")
})

test("message events invalidate the result even during an in-flight read", async () => {
  const cache = createShortLivedReadCache<number>(1_500)
  const pending = deferred<number>()
  let invalidate = () => undefined
  let reads = 0
  const result = cache.read("conversation", () => {
    reads += 1
    return reads === 1 ? pending.promise : Promise.resolve(21)
  }, (listener) => { invalidate = listener; return () => undefined })
  invalidate()
  pending.resolve(20)
  assert.equal(await result.promise, 21)
  assert.equal(reads, 2)
  cache.invalidate("conversation")
})

test("a completed result expires before a later navigation", async () => {
  const cache = createShortLivedReadCache<number>(0)
  const subscribe = () => () => undefined
  assert.equal(await cache.read("conversation", async () => 1, subscribe).promise, 1)
  const next = cache.read("conversation", async () => 2, subscribe)
  assert.equal(next.reused, false)
  assert.equal(await next.promise, 2)
  cache.invalidate("conversation")
})

test("a failed read is not retained, and accounts have separate keys", async () => {
  const cache = createShortLivedReadCache<number>(1_500)
  const subscribe = () => () => undefined
  await assert.rejects(cache.read("one:conversation", async () => { throw new Error("offline") }, subscribe).promise)
  assert.equal(await cache.read("one:conversation", async () => 1, subscribe).promise, 1)
  assert.equal(await cache.read("two:conversation", async () => 2, subscribe).promise, 2)
  cache.invalidate("one:conversation")
  cache.invalidate("two:conversation")
})
