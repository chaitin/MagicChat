import assert from "node:assert/strict"
import test from "node:test"

import type { ClientConversation } from "@/core/models"
import { createMessageBootstrap } from "@/features/bootstrap/message-bootstrap"
import { flattenVisibleConversations } from "@/domain/conversations/conversation-order"

const target = { id: "server", url: "https://example.test", userId: "user" }
const conversations = Array.from({ length: 40 }, (_, index) => ({
  id: `c${index}`,
})) as ClientConversation[]
const page = { messages: [], page: { hasMoreBefore: false, newestSeq: 0, oldestSeq: 0 } }

test("message bootstrap limits work, uses five workers, tolerates items, and deduplicates", async () => {
  let active = 0
  let maximum = 0
  const synchronized: string[] = []
  const run = createMessageBootstrap({
    listLocalConversations: async () => conversations,
    refreshConversations: async () => conversations,
    readLatestPage: async () => page,
    isUnauthorizedError: () => false,
    synchronizeLatest: async (_target, id, limit) => {
      assert.equal(limit, 20)
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      synchronized.push(id)
      if (id === "c3") throw new Error("unavailable")
      return page
    },
  })

  const first = run(target)
  assert.equal(run(target), first)
  await first
  assert.equal(maximum, 5)
  assert.equal(synchronized.length, 30)
  assert.equal((await first).size, 29)
  assert.equal((await first).get("c0"), page)
  assert.equal(run(target), first)
})

test("network synchronization follows the visible UI order instead of raw storage order", async () => {
  const raw = Array.from({ length: 31 }, (_, index) => ({
    id: `raw-${index}`,
    pinned: index === 30,
    type: "direct",
  })) as ClientConversation[]
  const synchronized: string[] = []
  const run = createMessageBootstrap({
    listLocalConversations: async () => [],
    refreshConversations: async () => raw,
    readLatestPage: async () => page,
    synchronizeLatest: async (_target, id) => {
      synchronized.push(id)
      return page
    },
    isUnauthorizedError: () => false,
  })

  await run({ ...target, id: "visible-order" })
  assert.equal(synchronized.length, 30)
  assert.ok(synchronized.includes("raw-30"))
  assert.ok(!synchronized.includes("raw-9"))
})

test("message bootstrap has a bounded successful timeout", async () => {
  const run = createMessageBootstrap(
    {
      listLocalConversations: async () => conversations.slice(0, 1),
      refreshConversations: async () => conversations.slice(0, 1),
      readLatestPage: async () => page,
      synchronizeLatest: () => new Promise(() => undefined),
      isUnauthorizedError: () => false,
    },
    5
  )
  await run(target)
})

test("timed-out bootstrap continues publishing late pages and can run again", async () => {
  let resolveNetwork!: (value: typeof page) => void
  let refreshes = 0
  const published: string[] = []
  const run = createMessageBootstrap(
    {
      listLocalConversations: async () => [],
      refreshConversations: async () => {
        refreshes += 1
        return conversations.slice(0, 1)
      },
      readLatestPage: async () => page,
      synchronizeLatest: () => new Promise((resolve) => {
        resolveNetwork = resolve
      }),
      isUnauthorizedError: () => false,
    },
    5,
    5
  )

  await run(target, (id) => published.push(id))
  assert.deepEqual(published, [])
  resolveNetwork(page)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.deepEqual(published, ["c0"])
  await new Promise((resolve) => setTimeout(resolve, 10))
  void run(target)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(refreshes, 2)
})

test("an unauthorized conversation refresh is propagated and can be retried", async () => {
  let attempts = 0
  const unauthorized = new Error("unauthorized")
  const run = createMessageBootstrap({
    listLocalConversations: async () => [],
    refreshConversations: async () => {
      attempts += 1
      if (attempts === 1) throw unauthorized
      return []
    },
    readLatestPage: async () => page,
    synchronizeLatest: async () => page,
    isUnauthorizedError: (error) => error === unauthorized,
  })
  await assert.rejects(run(target), unauthorized)
  await run(target)
  assert.equal(attempts, 2)
})

test("message bootstrap hydrates local messages beyond the network synchronization limit", async () => {
  const synchronized: string[] = []
  const locallyRead: string[] = []
  const localPage = {
    messages: [{ id: "m39", seq: 39 }],
    page: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      limit: 20,
      newestSeq: 39,
      oldestSeq: 39,
    },
  } as never
  const run = createMessageBootstrap({
    listLocalConversations: async () => conversations,
    refreshConversations: async () => conversations,
    readLatestPage: async (_target, id, limit) => {
      assert.equal(limit, 20)
      locallyRead.push(id)
      return id === "c39" ? localPage : page
    },
    synchronizeLatest: async (_target, id) => {
      synchronized.push(id)
      return page
    },
    isUnauthorizedError: () => false,
  })

  const results = await run({ ...target, id: "local-hydration" })
  assert.equal(locallyRead.length, 40)
  assert.equal(synchronized.length, 30)
  assert.deepEqual(
    synchronized.sort(),
    flattenVisibleConversations(conversations)
      .slice(0, 30)
      .map(({ id }) => id)
      .sort()
  )
  assert.equal(results.get("c39"), localPage)
})

test("offline refresh still hydrates all local conversations", async () => {
  const localPage = {
    messages: [{ id: "offline-m31", seq: 31 }],
    page: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      limit: 20,
      newestSeq: 31,
      oldestSeq: 31,
    },
  } as never
  let synchronized = 0
  const run = createMessageBootstrap({
    listLocalConversations: async () => conversations,
    refreshConversations: async () => {
      throw new Error("offline")
    },
    readLatestPage: async (_target, id) => id === "c31" ? localPage : page,
    synchronizeLatest: async () => {
      synchronized += 1
      return page
    },
    isUnauthorizedError: () => false,
  })

  const results = await run({ ...target, id: "offline-local-hydration" })
  assert.equal(results.get("c31"), localPage)
  assert.equal(synchronized, 0)
})
