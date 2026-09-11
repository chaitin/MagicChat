import assert from "node:assert/strict"
import test from "node:test"

import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { createMemoryConversationCacheStore } from "@/data/conversations/conversation-cache-store"
import { createConversationManager } from "@/data/conversations/conversation-manager"

const target: AuthenticatedTarget = {
  id: "server",
  url: "https://example.test",
  userId: "user-1",
}

function conversation(
  id: string,
  patch: Partial<ClientConversation> = {}
): ClientConversation {
  return {
    avatar: "",
    canSend: true,
    createdAt: "2026-01-01T00:00:00Z",
    id,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSender: null,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 0,
    name: id,
    notificationMuted: false,
    pinned: false,
    type: "group",
    unreadCount: 0,
    visibility: "private",
    ...patch,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(fetch: () => Promise<ClientConversation[]> = async () => []) {
  const store = createMemoryConversationCacheStore()
  let notifications = 0
  const manager = createConversationManager({
    store,
    fetch,
    notify: () => {
      notifications += 1
    },
    subscribe: () => () => undefined,
    now: () => 100,
  })
  return { manager, store, notifications: () => notifications }
}

test("HTTP batch merges 100 rows into 150 cached rows without deleting absences", async () => {
  const remote = Array.from({ length: 100 }, (_, index) =>
    conversation(`c-${index}`, { name: `remote-${index}` })
  )
  const { manager, notifications } = setup(async () => remote)
  await manager.upsert(
    target,
    Array.from({ length: 150 }, (_, index) => conversation(`c-${index}`))
  )

  await manager.refresh(target)
  const rows = await manager.list(target)

  assert.equal(rows.length, 150)
  assert.equal(rows.find((row) => row.id === "c-0")?.name, "remote-0")
  assert.equal(
    rows.some((row) => row.id === "c-149"),
    true
  )
  assert.equal(notifications(), 2)
})

test("HTTP batch updates existing rows, adds new rows, and notifies once", async () => {
  const { manager, notifications } = setup(async () => [
    conversation("old", { name: "updated" }),
    conversation("new"),
  ])
  await manager.upsert(target, conversation("old"))
  const before = notifications()

  await manager.refresh(target)

  assert.deepEqual((await manager.list(target)).map((row) => row.id).sort(), [
    "new",
    "old",
  ])
  assert.equal((await manager.list(target))[0]?.name, "updated")
  assert.equal(notifications() - before, 1)
})

test("memory cache isolates server and user targets", async () => {
  const { manager } = setup()
  const otherUser = { ...target, userId: "user-2" }
  const otherServer = { ...target, id: "other" }
  await manager.upsert(target, conversation("one"))
  await manager.upsert(otherUser, conversation("two"))
  await manager.upsert(otherServer, conversation("three"))

  assert.deepEqual(
    (await manager.list(target)).map((row) => row.id),
    ["one"]
  )
  assert.deepEqual(
    (await manager.list(otherUser)).map((row) => row.id),
    ["two"]
  )
  assert.deepEqual(
    (await manager.list(otherServer)).map((row) => row.id),
    ["three"]
  )
})

test("current HTTP restores an old tombstone and stale HTTP stays blocked", async () => {
  const store = createMemoryConversationCacheStore()
  await store.upsertBatch(target, [conversation("old")], {
    observedAt: 10,
    source: "mutation",
  })
  await store.tombstone(target, ["old"], 20)
  await store.upsertBatch(target, [conversation("old", { name: "http" })], {
    observedAt: 30,
    source: "http",
  })
  assert.equal((await store.list(target))[0]?.name, "http")

  await store.tombstone(target, ["racing"], 50)
  await store.upsertBatch(target, [conversation("racing")], {
    observedAt: 60,
    source: "http",
    startedAt: 40,
  })
  assert.equal(
    (await store.list(target)).some((row) => row.id === "racing"),
    false
  )
})

test("only mutations started after a tombstone can restore it", async () => {
  const store = createMemoryConversationCacheStore()
  await store.upsertBatch(
    target,
    [
      conversation("one", {
        projects: [{ id: "p", name: "P", avatar: "", description: "" }],
      }),
    ],
    { observedAt: 1, source: "mutation" }
  )
  await store.tombstone(target, ["one"], 20)
  await store.upsertBatch(
    target,
    [conversation("one", { name: "stale", projects: undefined })],
    { observedAt: 30, source: "mutation", startedAt: 15 }
  )
  assert.deepEqual(await store.list(target), [])

  await store.upsertBatch(
    target,
    [conversation("one", { name: "restored", projects: undefined })],
    { observedAt: 40, source: "mutation", startedAt: 25 }
  )
  const restored = (await store.list(target))[0]
  assert.equal(restored?.name, "restored")
  assert.equal(restored?.projects?.[0]?.id, "p")
})

test("patch does not create missing rows and monotonic sequence fields never regress", async () => {
  const { manager } = setup()
  assert.equal(await manager.patch(target, "missing", { pinned: true }), false)
  await manager.upsert(
    target,
    conversation("one", {
      lastChoiceSeq: 8,
      lastMentionedSeq: 7,
      lastMessageSeq: 10,
      lastReadSeq: 9,
    })
  )
  assert.equal(
    await manager.patch(
      target,
      "one",
      {
        lastChoiceSeq: 1,
        lastMentionedSeq: 2,
        lastMessageSeq: 3,
        lastReadSeq: 4,
      },
      { observedAt: 200, source: "mutation" }
    ),
    true
  )
  const row = (await manager.list(target))[0]
  assert.deepEqual(
    [
      row.lastChoiceSeq,
      row.lastMentionedSeq,
      row.lastMessageSeq,
      row.lastReadSeq,
    ],
    [8, 7, 10, 9]
  )
})

test("patch does not restore a tombstoned conversation", async () => {
  const { manager } = setup()
  await manager.upsert(target, conversation("one"))
  await manager.remove(target, "one")

  assert.equal(await manager.patch(target, "one", { pinned: true }), false)
  assert.deepEqual(await manager.list(target), [])
})

test("HTTP response cannot overwrite a later mutation", async () => {
  const response = deferred<ClientConversation[]>()
  const { manager } = setup(() => response.promise)
  await manager.upsert(target, conversation("one", { name: "before" }))

  const refresh = manager.refresh(target)
  await manager.patch(target, "one", { name: "after" })
  response.resolve([conversation("one", { name: "stale" })])
  await refresh

  assert.equal((await manager.list(target))[0]?.name, "after")
})

test("functional patches use the latest row and keep message previews aligned", async () => {
  const { manager } = setup()
  await manager.upsert(
    target,
    conversation("one", {
      lastMessageId: "m10",
      lastMessageSeq: 10,
      lastMessageSummary: "ten",
      unreadCount: 0,
    })
  )

  await Promise.all([
    manager.patch(target, "one", (current) => ({
      lastMessageId: "m11",
      lastMessageSeq: 11,
      lastMessageSummary: "eleven",
      unreadCount: current.unreadCount + 1,
    })),
    manager.patch(target, "one", (current) => ({
      lastMessageId: "m12",
      lastMessageSeq: 12,
      lastMessageSummary: "twelve",
      unreadCount: current.unreadCount + 1,
    })),
  ])
  await manager.patch(target, "one", {
    lastMessageId: "m11-stale",
    lastMessageSeq: 11,
    lastMessageSummary: "stale",
  })

  const row = await manager.get(target, "one")
  assert.equal(row?.lastMessageSeq, 12)
  assert.equal(row?.lastMessageId, "m12")
  assert.equal(row?.lastMessageSummary, "twelve")
  assert.equal(row?.unreadCount, 2)
})

test("removeTree includes descendants hidden by an earlier tombstone", async () => {
  const { manager, store } = setup()
  await manager.upsert(target, [
    conversation("root"),
    conversation("child", {
      type: "topic",
      topic: {
        archived: false,
        parentConversationId: "root",
        parentConversationName: "root",
        parentConversationType: "group",
        participating: true,
        sourceMessageId: "",
        sourceMessageSeq: 0,
      },
    }),
  ])
  await store.tombstone(target, ["root"], 50)
  await manager.removeTree(target, "root", 60)
  await manager.upsert(target, conversation("root"))

  assert.deepEqual(
    (await manager.list(target)).map((row) => row.id),
    ["root"]
  )
})

test("refresh is single-flight and caller abort does not cancel shared work", async () => {
  const response = deferred<ClientConversation[]>()
  let calls = 0
  const { manager } = setup(async () => {
    calls += 1
    return response.promise
  })
  const controller = new AbortController()
  const cancelled = manager.refresh(target, { signal: controller.signal })
  const shared = manager.refresh(target)
  controller.abort(new Error("caller cancelled"))
  response.resolve([conversation("one")])

  await assert.rejects(cancelled, /caller cancelled/)
  assert.equal((await shared).length, 1)
  assert.equal(calls, 1)
})
