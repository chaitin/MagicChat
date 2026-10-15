import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { ClientConversation, ClientMessageList } from "@/core/models"
import { createMessageBootstrap } from "@/features/bootstrap/message-bootstrap"

const target = { id: "server", url: "https://example.test", userId: "user" }
const conversations = Array.from({ length: 55 }, (_, index) => ({ id: `c${index}` })) as ClientConversation[]
const page = { messages: [{ id: "cached", seq: 1 }], page: { hasMoreBefore: false, newestSeq: 1, oldestSeq: 1 } } as ClientMessageList

test("startup hydrates all local caches with five workers, but performs no network synchronization", async () => {
  let active = 0, maximum = 0, reads = 0
  const published: string[] = []
  const run = createMessageBootstrap({
    listLocalConversations: async () => conversations,
    readLatestPage: async (_target, _id, limit) => {
      assert.equal(limit, 20)
      reads++; active++; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return page
    },
  })
  const first = run(target, (id) => published.push(id))
  assert.equal(run(target), first)
  const result = await first
  assert.equal(reads, 55)
  assert.equal(maximum, 5)
  assert.equal(result.size, 55)
  assert.equal(result.get("c54"), page)
  assert.equal(published.length, 55)
  assert.equal(run(target), first)
  const production = readFileSync(new URL("../src/features/bootstrap/client-message-bootstrap.ts", import.meta.url), "utf8")
  assert.doesNotMatch(production, /refreshSnapshot|synchronizeLatest|catchUpAfter|listSyncStates|createClientMessageSyncRound/)
})

test("failed local reads do not block other cached conversations", async () => {
  const run = createMessageBootstrap({
    listLocalConversations: async () => conversations,
    readLatestPage: async (_target, id) => { if (id === "c3") throw new Error("cache unavailable"); return page },
  })
  const result = await run(target)
  assert.equal(result.size, 54)
  assert.equal(result.has("c3"), false)
})

test("unavailable local database is non-fatal", async () => {
  const run = createMessageBootstrap({
    listLocalConversations: async () => { throw new Error("database unavailable") },
    readLatestPage: async () => page,
  })
  assert.equal((await run(target)).size, 0)
})

test("a timed-out local warmup keeps publishing and can run again later", async () => {
  let release!: (value: ClientMessageList) => void
  let lists = 0
  const published: string[] = []
  const run = createMessageBootstrap({
    listLocalConversations: async () => { lists++; return conversations.slice(0, 1) },
    readLatestPage: () => new Promise((resolve) => { release = resolve }),
  }, 5, 5)
  assert.equal((await run(target, (id) => published.push(id))).size, 0)
  release(page)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.deepEqual(published, ["c0"])
  await new Promise((resolve) => setTimeout(resolve, 10))
  const next = run(target)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(lists, 2)
  release(page)
  await next
})

test("local warmup flights are isolated by immutable account and server target", async () => {
  let lists = 0
  const run = createMessageBootstrap({
    listLocalConversations: async () => { lists++; return [] },
    readLatestPage: async () => page,
  })
  await Promise.all([
    run(target), run({ ...target, userId: "other" }), run({ ...target, id: "other" }), run({ ...target, url: "https://example.test/other" }),
  ])
  assert.equal(lists, 4)
})
