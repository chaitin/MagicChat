import assert from "node:assert/strict"
import test from "node:test"

import { createCoalescedConversationListLoader } from "../src/renderer/features/chat/conversation-list-loader.ts"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("burst updates share one in-flight list request and ignore stale results", async () => {
  let resolveFirst!: (value: string) => void
  let reads = 0
  const applied: string[] = []
  const loader = createCoalescedConversationListLoader(
    () =>
      ++reads === 1
        ? new Promise<string>((resolve) => {
            resolveFirst = resolve
          })
        : Promise.resolve("latest"),
    (result) => {
      applied.push(result)
    },
    () => {
      throw new Error("unexpected failure")
    },
  )
  loader.request()
  loader.request()
  loader.request()
  assert.equal(reads, 1)
  resolveFirst("stale")
  await tick()
  assert.equal(reads, 2)
  assert.deepEqual(applied, ["latest"])
  loader.dispose()
})

test("a stale failure is suppressed when a newer refresh succeeds", async () => {
  let rejectFirst!: (error: Error) => void
  let reads = 0
  const applied: string[] = []
  const errors: unknown[] = []
  const loader = createCoalescedConversationListLoader(
    () =>
      ++reads === 1
        ? new Promise<string>((_resolve, reject) => {
            rejectFirst = reject
          })
        : Promise.resolve("recovered"),
    (value) => {
      applied.push(value)
    },
    (error) => {
      errors.push(error)
    },
  )
  loader.request()
  loader.request()
  rejectFirst(new Error("stale error"))
  await tick()
  assert.deepEqual(applied, ["recovered"])
  assert.deepEqual(errors, [])
  loader.dispose()
})

test("disposed target ignores late results and new target remains independent", async () => {
  let resolveOld!: (value: string) => void
  const applied: string[] = []
  const old = createCoalescedConversationListLoader(
    () =>
      new Promise<string>((resolve) => {
        resolveOld = resolve
      }),
    (value) => {
      applied.push(value)
    },
    () => undefined,
  )
  old.request()
  old.dispose()
  old.request()
  const current = createCoalescedConversationListLoader(
    async () => "new",
    (value) => {
      applied.push(value)
    },
    () => undefined,
  )
  current.request()
  resolveOld("old")
  await tick()
  assert.deepEqual(applied, ["new"])
  current.dispose()
})
