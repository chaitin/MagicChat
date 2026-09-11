import assert from "node:assert/strict"
import test from "node:test"

import type { ClientMessage, ClientMessageList } from "@/core/models"
import { createMessageManager, type MessageManagerDependencies } from "@/data/messages/message-manager-core"

const target = { id: "server", url: "https://example.test", userId: "user" }
const conversationId = "conversation"

function message(seq: number, id = `m${seq}`): ClientMessage {
  return {
    body: { content: `message ${seq}`, type: "text" },
    clientMessageId: `client-${id}`,
    conversationId,
    createdAt: new Date(seq * 1000).toISOString(),
    id,
    reactionVersion: 0,
    reactions: [],
    sender: { avatar: "", id: "other", name: "Other", nickname: "", type: "user" },
    seq,
  }
}

function list(messages: ClientMessage[], overrides: Partial<ClientMessageList["page"]> = {}): ClientMessageList {
  return {
    messages,
    page: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      limit: 20,
      newestSeq: messages[0]?.seq ?? 0,
      oldestSeq: messages.at(-1)?.seq ?? 0,
      ...overrides,
    },
  }
}

type FakeOptions = Partial<{
  readLatestLocal: () => Promise<ClientMessage[]>
  readBeforeLocal: () => Promise<ClientMessage[]>
  readSyncStateLocal: () => Promise<{ hasMoreBefore: boolean; httpSyncedThroughSeq: number } | null>
  fetchLatestRemote: () => Promise<ClientMessageList>
  fetchBeforeRemote: () => Promise<ClientMessageList>
  fetchAfterRemote: () => Promise<ClientMessageList>
  persistLatest: () => Promise<void>
  persistBefore: () => Promise<void>
  persistAfter: () => Promise<number>
  clearGlobalCache: () => Promise<void>
}>

function fakeManager(options: FakeOptions = {}) {
  const calls = { latest: 0, before: 0, after: 0, persistLatest: 0, clear: 0, telemetry: [] as unknown[] }
  const deleted = new Set<string>()
  const repository = {
    readLatestLocal: options.readLatestLocal ?? (async () => []),
    readBeforeLocal: options.readBeforeLocal ?? (async () => []),
    readSyncStateLocal: options.readSyncStateLocal ?? (async () => null),
    fetchLatestRemote: async () => { calls.latest++; return (options.fetchLatestRemote ?? (async () => list([])))() },
    fetchBeforeRemote: async () => { calls.before++; return (options.fetchBeforeRemote ?? (async () => list([])))() },
    fetchAfterRemote: async () => { calls.after++; return (options.fetchAfterRemote ?? (async () => list([])))() },
    persistLatest: async () => { calls.persistLatest++; return (options.persistLatest ?? (async () => undefined))() },
    persistBefore: options.persistBefore ?? (async () => undefined),
    persistAfter: options.persistAfter ?? (async () => 0),
    persistMessages: async () => undefined,
  }
  const noop = async () => undefined
  const dependencies = {
    repository,
    api: new Proxy({}, { get: () => noop }),
    events: { publishConversationMessagesChanged: () => undefined },
    telemetry: { reportMessageCacheError: (event: unknown) => calls.telemetry.push(event) },
    clearGlobalCache: async () => { calls.clear++; await options.clearGlobalCache?.() },
    getGlobalCacheSize: async () => 0,
    createMessageTombstoneStore: () => ({
      applyChoiceMessageTombstone: (_target: unknown, candidate: ClientMessage) => deleted.has(candidate.id) ? null : candidate,
      clearAllMessageTombstones: () => deleted.clear(),
      clearConversationMessageTombstones: () => deleted.clear(),
      clearServerMessageTombstones: () => deleted.clear(),
      recordChoiceMessageTombstone: (_target: unknown, snapshot: { messageId: string; status: string }) => {
        if (snapshot.status === "deleted") deleted.add(snapshot.messageId)
      },
    }),
    getMessageSyncState: async () => null,
    listMessageSyncStates: async () => [],
    persistMessageChoiceEvent: noop,
    persistMessageChoiceSnapshot: noop,
    persistMessageReactionsEvent: async () => "applied",
    persistMessageReactionSnapshot: noop,
    removeConversationMessageCache: noop,
    removeServerMessageCache: noop,
    updatePersistedMessage: noop,
    applyMessageChoiceEvent: (current: ClientMessage) => current,
    applyMessageChoiceSnapshot: (current: ClientMessage) => current,
    applyMessageReactionsUpdate: (current: ClientMessage) => ({ message: current, status: "applied" }),
    applyMessageReactionSnapshot: (current: ClientMessage) => current,
    preserveNewerMessageState: (current: ClientMessage, incoming: ClientMessage) =>
      current.reactionVersion > incoming.reactionVersion ? current : incoming,
    formatClientMessageBodySummary: () => "",
  } as unknown as MessageManagerDependencies
  return { calls, manager: createMessageManager(dependencies) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("latest local page merges persisted and newer runtime messages", async () => {
  const { manager } = fakeManager({ readLatestLocal: async () => [message(2), message(1)] })
  await manager.writeMessages(target, [message(3), { ...message(2), reactionVersion: 2 }])
  const result = await manager.readLatestPage(target, conversationId, 10)
  assert.deepEqual(result.messages.map((item) => item.seq), [3, 2, 1])
  assert.equal(result.messages.find((item) => item.seq === 2)?.reactionVersion, 2)
})

test("before uses contiguous cache, but gaps and cache read failures use remote", async () => {
  const cached = fakeManager({
    readSyncStateLocal: async () => ({ hasMoreBefore: true, httpSyncedThroughSeq: 10 }),
    readBeforeLocal: async () => [message(8)],
  })
  assert.deepEqual((await cached.manager.loadMessagePage(target, conversationId, { beforeSeq: 9, limit: 20 })).messages, [message(8)])
  assert.equal(cached.calls.before, 0)

  const gap = fakeManager({ readSyncStateLocal: async () => ({ hasMoreBefore: true, httpSyncedThroughSeq: 3 }) })
  await gap.manager.loadMessagePage(target, conversationId, { beforeSeq: 9, limit: 20 })
  assert.equal(gap.calls.before, 1)

  const failed = fakeManager({
    readSyncStateLocal: async () => ({ hasMoreBefore: true, httpSyncedThroughSeq: 10 }),
    readBeforeLocal: async () => { throw new Error("sqlite read") },
  })
  await failed.manager.loadMessagePage(target, conversationId, { beforeSeq: 9, limit: 20 })
  assert.equal(failed.calls.before, 1)
  assert.equal(failed.calls.telemetry.length, 1)
})

test("catchup returns the committed cursor even when the response is stale", async () => {
  const { manager } = fakeManager({
    fetchAfterRemote: async () => list([message(8)]),
    persistAfter: async () => 12,
  })
  const result = await manager.catchUpAfter(target, conversationId, 10, 20)
  assert.equal(result.committedSeq, 12)
  assert.deepEqual(result.result.messages.map((item) => item.seq), [8])
})

test("latest synchronization is singleflight per conversation", async () => {
  const pending = deferred<ClientMessageList>()
  const { manager, calls } = fakeManager({ fetchLatestRemote: () => pending.promise })
  const first = manager.synchronizeLatest(target, conversationId, 20)
  const second = manager.synchronizeLatest(target, conversationId, 20)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls.latest, 1)
  pending.resolve(list([message(1)]))
  await first
})

test("clear is a barrier for old synchronization and postpones new synchronization without late writes", async () => {
  const network = deferred<ClientMessageList>()
  const cleared = deferred<void>()
  const order: string[] = []
  const { manager, calls } = fakeManager({
    fetchLatestRemote: () => network.promise,
    persistLatest: async () => { order.push("old-write") },
    clearGlobalCache: async () => { order.push("clear"); await cleared.promise },
  })
  const oldSync = manager.synchronizeLatest(target, "old", 20)
  const clear = manager.clearAllOfflineMessages()
  const newSync = manager.synchronizeLatest(target, "new", 20)
  await Promise.resolve()
  assert.equal(calls.latest, 1)
  network.resolve(list([message(1)]))
  await oldSync
  while (!order.includes("clear")) await Promise.resolve()
  assert.deepEqual(order, ["old-write", "clear"])
  cleared.resolve()
  await clear
  await newSync
  assert.equal(calls.latest, 2)
  assert.deepEqual(order, ["old-write", "clear", "old-write"])
})

test("choice tombstone filters an older in-flight response", async () => {
  const pending = deferred<ClientMessageList>()
  const { manager } = fakeManager({ fetchLatestRemote: () => pending.promise })
  const sync = manager.synchronizeLatest(target, conversationId, 20)
  await manager.applyChoiceSnapshot(target, { conversationId, messageId: "deleted", status: "deleted" } as never)
  pending.resolve(list([message(1, "deleted")]))
  assert.deepEqual((await sync).messages, [])
  assert.deepEqual((await manager.readLatestPage(target, conversationId, 20)).messages, [])
})

test("SQLite latest read failure degrades to runtime and reports telemetry", async () => {
  const { manager, calls } = fakeManager({ readLatestLocal: async () => { throw new Error("sqlite") } })
  await manager.writeMessages(target, [message(2)])
  assert.deepEqual((await manager.readLatestPage(target, conversationId, 20)).messages, [message(2)])
  assert.equal(calls.telemetry.length, 1)
})

test("SQLite write failure still returns network result and reports telemetry", async () => {
  const remote = list([message(4)])
  const { manager, calls } = fakeManager({
    fetchLatestRemote: async () => remote,
    persistLatest: async () => { throw new Error("disk full") },
  })
  assert.deepEqual(await manager.synchronizeLatest(target, conversationId, 20), remote)
  assert.equal(calls.telemetry.length, 1)
})

test("offline and unauthorized network errors propagate unchanged", async () => {
  for (const error of [Object.assign(new Error("offline"), { code: "OFFLINE" }), Object.assign(new Error("unauthorized"), { status: 401 })]) {
    const { manager } = fakeManager({ fetchLatestRemote: async () => { throw error } })
    await assert.rejects(manager.synchronizeLatest(target, conversationId, 20), (caught) => caught === error)
  }
})
