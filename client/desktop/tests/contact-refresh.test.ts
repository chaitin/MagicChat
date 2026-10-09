import assert from "node:assert/strict"
import test from "node:test"

import { coalesceRefresh } from "../src/main/account/coalesced-refresh.ts"

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("concurrent contact refreshes run once more for later events", async () => {
  const first = deferred()
  const second = deferred()
  let runs = 0
  const refresh = coalesceRefresh(() => (++runs === 1 ? first.promise : second.promise))
  const request = refresh()
  assert.equal(refresh(), request)
  assert.equal(refresh(), request)
  assert.equal(runs, 1)
  first.resolve()
  await tick()
  assert.equal(runs, 2)
  second.resolve()
  await request
  assert.equal(runs, 2)
})

test("a newer refresh can recover a failed earlier result", async () => {
  const first = deferred()
  let runs = 0
  const refresh = coalesceRefresh(() => (++runs === 1 ? first.promise : Promise.resolve()))
  const request = refresh()
  refresh()
  first.reject(new Error("outdated failure"))
  await request
  assert.equal(runs, 2)
  await refresh()
  assert.equal(runs, 3)
})

test("latest contact refresh errors still reach the caller", async () => {
  const refresh = coalesceRefresh(async () => {
    throw new Error("unavailable")
  })
  await assert.rejects(refresh(), /unavailable/)
})
