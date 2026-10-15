import assert from "node:assert/strict"
import test from "node:test"
import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { createAutomaticMessageSynchronizer } from "@/data/messages/automatic-message-sync"

const target = { id: "server", url: "https://example.test", userId: "user" }
const conversation = (id: string, seq = 2, index = 0) => ({
  id, lastMessageSeq: seq, unreadCount: 0, pinned: false, type: "group",
  lastMessageAt: new Date(1_800_000_000_000 - index * 1_000).toISOString(),
}) as ClientConversation
const page = (): ClientMessageList => ({ messages: [], page: { hasMoreAfter: false, hasMoreBefore: false, limit: 20, newestSeq: 0, oldestSeq: 0 } })

function fixture(options: { count?: number; conversations?: ClientConversation[]; cursor?: number; delay?: number; beforeRefresh?: () => Promise<void>; fail?: (id: string, seq: number) => unknown } = {}) {
  const conversations = options.conversations ?? Array.from({ length: options.count ?? 55 }, (_, index) => conversation(`c${index.toString().padStart(2, "0")}`, 2, index))
  const cursors = new Map(conversations.map((item) => [item.id, options.cursor ?? 1]))
  const calls = { refresh: 0, states: 0, latest: [] as string[], after: [] as { id: string; seq: number; limit: number }[], maximum: 0 }
  let active = 0
  const createRound = createAutomaticMessageSynchronizer({
    refreshConversations: async () => { calls.refresh++; await options.beforeRefresh?.(); return conversations },
    listSyncStates: async () => { calls.states++; return [...cursors].map(([conversationId, httpSyncedThroughSeq]) => ({ conversationId, httpSyncedThroughSeq })) },
    synchronizeLatest: async (_target, id, limit) => { assert.equal(limit, 20); calls.latest.push(id); return page() },
    catchUpAfter: async (_target, id, seq, limit) => {
      calls.after.push({ id, seq, limit })
      active++; calls.maximum = Math.max(calls.maximum, active)
      try {
        if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay))
        const failure = options.fail?.(id, seq)
        if (failure) throw failure
        const committedSeq = Math.min(conversations.find((item) => item.id === id)!.lastMessageSeq, seq + limit)
        cursors.set(id, committedSeq)
        return { committedSeq, result: { ...page(), page: { ...page().page, hasMoreAfter: committedSeq < conversations.find((item) => item.id === id)!.lastMessageSeq } } }
      } finally { active-- }
    },
    isUnauthorizedError: (error) => typeof error === "object" && error !== null && "status" in error && error.status === 401,
  })
  return { calls, conversations, createRound, cursors }
}

test("55 cached conversations with no changes cause no message requests or rewrites", async () => {
  const f = fixture({ cursor: 2 })
  await f.createRound(target)()
  assert.equal(f.calls.refresh, 1)
  assert.equal(f.calls.states, 1)
  assert.deepEqual(f.calls.after, [])
  assert.deepEqual(f.calls.latest, [])
  assert.equal(f.conversations.length, 55)
})

test("automatic work is limited to 30 conversations and three network workers", async () => {
  const f = fixture({ delay: 2 })
  await f.createRound(target)()
  assert.equal(f.calls.after.length, 30)
  assert.equal(f.calls.maximum, 3)
  assert.ok(f.calls.after.every((call) => call.limit === 1))
  assert.deepEqual(f.calls.after.map((call) => call.id).sort(), f.conversations.slice(0, 30).map((item) => item.id).sort())
})

test("current and unread conversations get slots before inactive cached chats", async () => {
  const f = fixture()
  f.conversations[53]!.unreadCount = 1
  await f.createRound(target, { activeConversationId: "c54" })()
  assert.equal(f.calls.after.length, 30)
  assert.deepEqual(f.calls.after.slice(0, 2).map((call) => call.id), ["c54", "c53"])
  assert.ok(!f.calls.after.some((call) => call.id === "c29"))
})

test("only actual gaps are fetched, including query-cache cursor fallback", async () => {
  const f = fixture({ conversations: [conversation("same", 100), conversation("changed", 121), conversation("large", 201)], cursor: 100 })
  await f.createRound(target)()
  assert.deepEqual(f.calls.after, [{ id: "changed", seq: 100, limit: 20 }, { id: "changed", seq: 120, limit: 1 }])
  assert.deepEqual(f.calls.latest, [])
  const fallback = fixture({ conversations: [conversation("cached", 3)], cursor: 0 })
  // A zero persisted cursor must not override a real persisted sync state; fallback is for absent states.
  fallback.cursors.clear()
  await fallback.createRound(target, { getCachedSeq: () => 1 })()
  assert.deepEqual(fallback.calls.after, [{ id: "cached", seq: 1, limit: 2 }])
})

test("one fixed 100-message budget is preserved across retries", async () => {
  let failed = false
  const f = fixture({ conversations: [conversation("a", 101), conversation("b", 2, 1)], fail: (id, seq) => {
    if (id === "a" && seq === 41 && !failed) { failed = true; return new Error("offline") }
  } })
  const round = f.createRound(target)
  await assert.rejects(round(), /offline/)
  await round()
  assert.equal(f.calls.refresh, 1)
  assert.equal(f.calls.states, 1)
  assert.deepEqual(f.calls.after.map((call) => call.seq), [1, 21, 41, 41, 61, 81])
  assert.ok(f.calls.after.every((call) => call.id === "a"))
})

test("retry resumes the failed page without redoing completed conversations", async () => {
  let failed = false
  const f = fixture({ conversations: [conversation("a", 41), conversation("b", 2, 1)], fail: (id, seq) => {
    if (id === "a" && seq === 21 && !failed) { failed = true; return new Error("offline") }
  } })
  const round = f.createRound(target)
  await assert.rejects(round())
  await round()
  assert.deepEqual(f.calls.after.filter((call) => call.id === "a").map((call) => call.seq), [1, 21, 21])
  assert.equal(f.calls.after.filter((call) => call.id === "b").length, 1)
  assert.equal(f.calls.refresh, 1)
})

test("overlapping same-account rounds share exactly the same in-flight work", async () => {
  let release!: () => void
  const f = fixture({ count: 2, beforeRefresh: () => new Promise<void>((resolve) => { release = resolve }) })
  const a = f.createRound(target)()
  const b = f.createRound({ ...target, url: `${target.url}/` })()
  assert.equal(a, b)
  release()
  await Promise.all([a, b])
  assert.equal(f.calls.refresh, 1)
  assert.equal(f.calls.after.length, 2)
})

test("a new transport waits for older work then fetches a post-subscription snapshot", async () => {
  const f = fixture({ count: 1, delay: 2 })
  const previous = f.createRound(target)()
  while (!f.calls.after.length) await Promise.resolve()
  const next = f.createRound(target, { freshSnapshot: true })()
  assert.equal(f.calls.refresh, 1)
  f.conversations[0]!.lastMessageSeq = 3
  await Promise.all([previous, next])
  assert.equal(f.calls.refresh, 2)
  assert.deepEqual(f.calls.after.map((call) => call.seq), [1, 2])
})

test("a previous credential's 401 cannot fail a fresh authenticated round", async () => {
  const unauthorized = { status: 401 }
  let failed = false
  const f = fixture({ count: 1, delay: 2, fail: () => {
    if (!failed) { failed = true; return unauthorized }
  } })
  const previous = f.createRound(target)()
  const rejected = assert.rejects(previous, (error) => error === unauthorized)
  while (!f.calls.after.length) await Promise.resolve()
  const current = f.createRound(target, { freshSnapshot: true })()
  await rejected
  await current
  assert.equal(f.calls.refresh, 2)
  assert.equal(f.calls.after.length, 2)
})

test("different accounts and servers never share a round", async () => {
  const f = fixture({ count: 0 })
  await Promise.all([
    target,
    { ...target, userId: "other" },
    { ...target, id: "other" },
    { ...target, url: "https://example.test/other" },
  ].map((value: AuthenticatedTarget) => f.createRound(value)()))
  assert.equal(f.calls.refresh, 4)
})

test("completed round checkpoints are reusable, but a new connection gets a fresh snapshot", async () => {
  const f = fixture({ count: 1 })
  const round = f.createRound(target)
  await round(); await round()
  assert.equal(f.calls.refresh, 1)
  await f.createRound(target)()
  assert.equal(f.calls.refresh, 2)
  assert.equal(f.calls.after.length, 1)
})

test("deleted or inaccessible individual chats do not cause endless recovery retries", async () => {
  const f = fixture({ count: 2, fail: (id) => ({ status: id === "c00" ? 403 : 404 }) })
  const round = f.createRound(target)
  await round(); await round()
  assert.equal(f.calls.after.length, 2)
})

test("authentication failure takes precedence over concurrent network failures", async () => {
  const unauthorized = { status: 401 }
  const f = fixture({ count: 2, fail: (id) => id === "c00" ? new Error("offline") : unauthorized })
  await assert.rejects(f.createRound(target)(), (error) => error === unauthorized)
})

test("initial latest-page work also obeys the 100-message round budget", async () => {
  const f = fixture({ conversations: Array.from({ length: 10 }, (_, index) => conversation(`c${index}`, 100, index)), cursor: 0 })
  await f.createRound(target)()
  assert.equal(f.calls.latest.length, 5)
  assert.deepEqual(f.calls.after, [])
})
