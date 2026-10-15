import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { infiniteQueryOptions, QueryClient, queryOptions } from "@tanstack/react-query"
import ts from "typescript"
import type { ClientConversation, ClientMessage, ClientMessageList, MessageChoiceSnapshot, MessageReactionSnapshot } from "../src/core/models.ts"
import * as serverKeys from "../src/data/server-key.ts"
import * as automaticSync from "../src/data/messages/automatic-message-sync.ts"
import * as syncBudget from "../src/domain/messages/message-sync-budget.ts"

type QueryModule = typeof import("../src/data/query/index")
type SyncModule = typeof import("../src/realtime/realtime-sync")
type SnapshotRequest = { conversationId: string; messageIds: string[] }
const target = { id: "server", url: "https://example.test", userId: "user-a" }

function loadModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  runInNewContext(code, { exports, performance, require(name: string) {
    if (!(name in dependencies)) throw new Error(`unexpected import ${name}`)
    return dependencies[name]
  } })
  return exports as T
}

function conversation(lastMessageSeq = 2, id = "conversation"): ClientConversation {
  return {
    avatar: "", canSend: true, createdAt: "2026-07-28T00:00:00Z", id,
    lastChoiceSeq: 0, lastMentionedSeq: 0, lastMessageAt: null, lastMessageId: null,
    lastMessageSeq, lastMessageSender: null, lastMessageSummary: "", lastReadSeq: 0,
    memberCount: 0, name: "会话", notificationMuted: false, pinned: false,
    type: "group", unreadCount: 0, visibility: "private",
  }
}
function message(id: string, seq: number, choice = false): ClientMessage {
  return {
    body: choice ? { content: "请选择", contentType: "text", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], selection: "single", type: "choice" } : { content: "离线前的消息", type: "text" },
    clientMessageId: "", conversationId: "conversation", createdAt: "2026-07-28T00:00:00Z",
    id, reactionVersion: 0, reactions: [], sender: { id: "sender", type: "user" }, seq,
  }
}
function cachedPage(messages: ClientMessage[]) {
  const seqs = messages.map((item) => item.seq)
  const page: ClientMessageList = { messages, page: { hasMoreAfter: false, hasMoreBefore: false, limit: 20, newestSeq: Math.max(0, ...seqs), oldestSeq: Math.min(...seqs) || 0 } }
  return { pageParams: [null], pages: [page] }
}

function fixture(options: { cursor?: number | null; latestSeq?: number; count?: number; failChoices?: number } = {}) {
  const cursor = options.cursor === undefined ? 2 : options.cursor
  const conversations = options.count === undefined ? [conversation(options.latestSeq)] : Array.from({ length: options.count }, (_, index) => conversation(options.latestSeq, `c${index}`))
  const cursors = new Map(cursor === null ? [] : conversations.map((item) => [item.id, cursor]))
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  let choiceFailures = options.failChoices ?? 0
  const calls = {
    refresh: 0, contacts: 0, projects: 0,
    after: [] as { conversationId: string; afterSeq: number; limit: number }[], latest: [] as string[],
    reactions: [] as SnapshotRequest[], choices: [] as SnapshotRequest[],
    appliedReactions: [] as MessageReactionSnapshot[], appliedChoices: [] as MessageChoiceSnapshot[], projectedChoices: [] as MessageChoiceSnapshot[],
  }
  const conversationManager = { refreshSnapshot: async () => { calls.refresh++; return { snapshot: conversations } } }
  const contactManager = { refresh: async () => { calls.contacts++ } }
  const projectManager = { refresh: async () => { calls.projects++ } }
  const isUnauthorizedError = () => false
  const messageManager = {
    listSyncStates: async () => [...cursors].map(([conversationId, httpSyncedThroughSeq]) => ({ conversationId, httpSyncedThroughSeq })),
    readLatestPage: async () => cachedPage([]).pages[0]!,
    synchronizeLatest: async (_target: unknown, id: string) => { calls.latest.push(id); return cachedPage([]).pages[0]! },
    catchUpAfter: async (_target: unknown, conversationId: string, afterSeq: number, limit: number) => {
      calls.after.push({ conversationId, afterSeq, limit })
      const committedSeq = Math.min(options.latestSeq ?? 2, afterSeq + limit)
      cursors.set(conversationId, committedSeq)
      return { committedSeq, result: cachedPage([]).pages[0]! }
    },
    fetchReactionSnapshots: async (_target: unknown, conversationId: string, messageIds: string[]) => {
      calls.reactions.push({ conversationId, messageIds: [...messageIds] })
      return messageIds.map((messageId): MessageReactionSnapshot => ({ conversationId, messageId, reactionVersion: 3, reactions: [{ count: 1, reactedByMe: false, text: "赞", users: [{ id: "other", name: "其他用户" }] }] }))
    },
    applyReactionSnapshot: async (_target: unknown, snapshot: MessageReactionSnapshot) => { calls.appliedReactions.push(snapshot) },
    fetchChoiceSnapshots: async (_target: unknown, conversationId: string, messageIds: string[]) => {
      calls.choices.push({ conversationId, messageIds: [...messageIds] })
      if (choiceFailures-- > 0) throw new Error("choice offline")
      return messageIds.map((messageId): MessageChoiceSnapshot => ({ conversationId, messageId, status: "active", choice: { myOptionIds: ["a"], options: [{ id: "a", responseCount: 1 }, { id: "b", responseCount: 0 }], responseCount: 1 } }))
    },
    applyChoiceSnapshot: async (_target: unknown, snapshot: MessageChoiceSnapshot) => { calls.appliedChoices.push(snapshot) },
  }
  const query = loadModule<QueryModule>("data/query/index.ts", {
    "@tanstack/react-query": { infiniteQueryOptions, QueryClient, queryOptions }, "@/data/auth/app-info-api": {},
    "@/data/contacts": { contactManager }, "@/data/conversations/index": { conversationManager },
    "@/data/users/current-user-api": {}, "@/data/projects": { projectManager }, "@/data/server-key": serverKeys,
  })
  const common = { "@/data/messages": { messageManager }, "@/data/messages/message-normalizer": {} }
  const reactionSync = loadModule("realtime/reaction-sync.ts", { ...common, "@/data/query": query })
  const choiceSync = loadModule("realtime/choice-sync.ts", { ...common, "@/data/messages/message-query-cache": {
    applyConversationMessagesChangedEvent: (_client: unknown, _target: unknown, _id: string, event: { snapshot: MessageChoiceSnapshot }) => { calls.projectedChoices.push(event.snapshot) },
  } })
  const clientSync = loadModule("data/messages/client-message-sync.ts", {
    "@/data/api-client": { isUnauthorizedError }, "@/data/conversations": { conversationManager },
    "@/data/messages": { messageManager }, "@/data/messages/automatic-message-sync": automaticSync,
  })
  const sync = loadModule<SyncModule>("realtime/realtime-sync.ts", {
    "@/data/api-client": { isUnauthorizedError }, "@/data/contacts": { contactManager }, "@/data/projects": { projectManager },
    "@/data/messages/automatic-message-sync": automaticSync, "@/data/messages/client-message-sync": clientSync,
    "@/domain/messages/message-sync-budget": syncBudget, "@/diagnostics/mobile-startup": { traceMobileStartup: () => undefined },
    "@/data/query": query, "./choice-sync": choiceSync, "./reaction-sync": reactionSync,
  })
  return {
    queryClient, queryKeys: query.queryKeys, calls,
    run: (activeConversationId?: string) => sync.synchronizeRealtimeData(queryClient, target, { activeConversationId }),
    create: (options: Parameters<SyncModule["createRealtimeSynchronization"]>[2]) => sync.createRealtimeSynchronization(queryClient, target, options),
    foreground: (messagesAlreadySynchronizing: boolean) => sync.refreshClientDataOnForeground(queryClient, target, { messagesAlreadySynchronizing }),
  }
}

test("55个预热缓存没有新消息时不扫描回应、选择或重写消息", async (t) => {
  const f = fixture({ count: 55 })
  t.after(() => f.queryClient.clear())
  for (let index = 0; index < 55; index++) f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, `c${index}`), cachedPage([message(`text-${index}`, 1), message(`choice-${index}`, 2, true)]))
  await f.run()
  assert.equal(f.calls.refresh, 1)
  assert.deepEqual(f.calls.after, [])
  assert.deepEqual(f.calls.latest, [])
  assert.deepEqual(f.calls.reactions, [])
  assert.deepEqual(f.calls.choices, [])
  assert.deepEqual(f.calls.appliedReactions, [])
})

test("当前聊天没有新消息时仍校准回应和选择，但其他缓存不参与", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1), message("choice", 2, true)]))
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "inactive"), cachedPage([message("inactive", 1, true)]))
  await f.run("conversation")
  assert.deepEqual(f.calls.after, [])
  assert.deepEqual(f.calls.reactions, [{ conversationId: "conversation", messageIds: ["choice", "text"] }])
  assert.deepEqual(f.calls.choices, [{ conversationId: "conversation", messageIds: ["choice"] }])
  assert.deepEqual(f.calls.appliedReactions.map((item) => item.reactionVersion), [3, 3])
  assert.equal(f.calls.appliedChoices[0]?.choice?.responseCount, 1)
  assert.deepEqual(f.calls.projectedChoices, f.calls.appliedChoices)
})

test("只有查询缓存而没有SQLite游标时仅给选中的会话补缺失序号", async (t) => {
  const f = fixture({ cursor: null, latestSeq: 3 })
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1)]))
  await f.run()
  assert.deepEqual(f.calls.after, [{ conversationId: "conversation", afterSeq: 1, limit: 2 }])
  assert.deepEqual(f.calls.reactions, [])
})

test("有SQLite游标时不重复执行内存兜底", async (t) => {
  const f = fixture({ cursor: 1, latestSeq: 3 })
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1)]))
  await f.run("conversation")
  assert.deepEqual(f.calls.after, [{ conversationId: "conversation", afterSeq: 1, limit: 2 }])
  assert.equal(f.calls.reactions.length, 1)
})

test("话题详情不被当作消息分页，校准只读取当前会话的准确Query Key", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationTopic(target, "topic"), { conversation: { id: "topic" } })
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1)]))
  await assert.doesNotReject(f.run("topic"))
  assert.deepEqual(f.calls.reactions, [])
  await f.run("conversation")
  assert.deepEqual(f.calls.reactions, [{ conversationId: "conversation", messageIds: ["text"] }])
})

test("其他账号、服务器、无效后缀和空会话ID不会被读取或请求", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  for (const foreign of [{ ...target, userId: "user-b" }, { ...target, id: "other-server" }, { ...target, url: "https://example.test/other" }]) f.queryClient.setQueryData(f.queryKeys.conversationMessages(foreign, "conversation"), cachedPage([message("foreign", 1)]))
  f.queryClient.setQueryData([...f.queryKeys.conversationMessages(target, "conversation"), "extra"], { notMessagePages: true })
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, ""), { notMessagePages: true })
  await assert.doesNotReject(f.run("conversation"))
  await assert.doesNotReject(f.run(""))
  assert.deepEqual(f.calls.after, [])
  assert.deepEqual(f.calls.reactions, [])
  assert.deepEqual(f.calls.choices, [])
})

test("当前会话校准最多20条且分页重复ID只请求一次", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  const data = cachedPage(Array.from({ length: 50 }, (_, index) => message(`m${index + 1}`, index + 1, index % 2 === 0)))
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), { pageParams: [null, 1], pages: [data.pages[0], data.pages[0]] })
  await f.run("conversation")
  assert.equal(f.calls.reactions.length, 1)
  assert.deepEqual(f.calls.reactions[0]!.messageIds, Array.from({ length: 20 }, (_, index) => `m${50 - index}`))
  assert.equal(f.calls.appliedReactions.length, 20)
  assert.equal(f.calls.appliedChoices.length, 10)
})

test("状态步骤失败只重试失败的选择，不重新刷新列表或成功的回应", async (t) => {
  const f = fixture({ failChoices: 1 })
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("choice", 2, true)]))
  const synchronize = f.create({ activeConversationId: "conversation" })
  await assert.rejects(synchronize(), /choice offline/)
  await synchronize()
  assert.equal(f.calls.refresh, 1)
  assert.equal(f.calls.reactions.length, 1)
  assert.equal(f.calls.choices.length, 2)
})

test("同步期间离开聊天页不继续校准已离开的聊天", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1)]))
  let active = "conversation"
  const pending = f.create({ getActiveConversationId: () => active })()
  active = ""
  await pending
  assert.deepEqual(f.calls.reactions, [])
})

test("账号已失效的旧恢复任务不再发起状态校准", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  f.queryClient.setQueryData(f.queryKeys.conversationMessages(target, "conversation"), cachedPage([message("text", 1)]))
  let current = true
  const pending = f.create({ activeConversationId: "conversation", isCurrent: () => current })()
  current = false
  await pending
  assert.deepEqual(f.calls.reactions, [])
})

test("回前台已有恢复任务时只刷新辅助数据，不再启动第二轮消息同步", async (t) => {
  const f = fixture()
  t.after(() => f.queryClient.clear())
  await f.foreground(true)
  assert.equal(f.calls.contacts, 1)
  assert.equal(f.calls.projects, 1)
  assert.equal(f.calls.refresh, 0)
  await f.foreground(false)
  assert.equal(f.calls.refresh, 1)
})
