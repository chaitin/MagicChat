import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseConversationPresenceEvent } from "../src/main/account/conversation-presence.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class AuthFailure extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

function harness(cached: boolean | "empty", connected = true) {
  const critical = deferred<void>()
  const directory = deferred<void>()
  const messages = deferred<void>()
  const started = deferred<void>()
  const transport = deferred<void>()
  if (connected) transport.resolve()
  const states: string[] = []
  const changes: Array<{ domains: string[] }> = []
  const presences: unknown[] = []
  let applyPresence!: (event: unknown) => void
  let online!: Promise<void>
  let snapshotCalls = 0
  let conversations = cached === true ? [{ id: "cached" }] : []
  let closed = false
  class Manager { async initialize() {}; close() {}; dispose() {} }
  class Database extends Manager {
    hasConversationSnapshot() { return cached !== false }
    listConversations() { return conversations }
    close() { closed = true }
  }
  class Conversations extends Manager {
    async refreshSnapshot() {
      snapshotCalls += 1
      await critical.promise
      conversations = [{ id: "fresh" }]
      return conversations
    }
    synchronizeMessages() { return messages.promise }
    listConversations() { return conversations }
  }
  class Realtime extends Manager {
    private options: { synchronize: () => Promise<void>; onStateChange: (state: string) => void }
    constructor(options: { synchronize: () => Promise<void>; onStateChange: (state: string) => void; applyPresenceEvent: (event: unknown) => void }) { super(); this.options = options; applyPresence = options.applyPresenceEvent }
    start() {
      started.resolve()
      online = transport.promise.then(() => this.options.synchronize()).then(() => this.options.onStateChange("ready"))
      return online
    }
  }
  const dependencies = {
    AuthFailure, parseConversationPresenceEvent, AccountDatabase: Database, AuthenticatedClient: Manager,
    ConversationManager: Conversations, ContactManager: Manager, SearchManager: Manager,
    ClientAppManager: Manager, ProjectManager: Manager, ProjectTaskManager: Manager,
    MediaManager: Manager, AvatarManager: Manager, RealtimeManager: Realtime,
    createDesktopEntitySync: () => ({ reconcile: () => directory.promise, dispose() {} }),
  }
  const exports: Record<string, any> = {}
  const source = readFileSync(new URL("../src/main/account/account-runtime.ts", import.meta.url), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(code, {
    exports, console, Buffer, setInterval, clearInterval,
    require: (specifier: string) => {
      if (specifier === "node:crypto") return { createHash }
      if (specifier === "node:fs/promises") return { mkdir: async () => undefined }
      if (specifier === "node:path") return path
      return dependencies
    },
  })
  const runtime = new exports.AccountRuntime({
    targetId: "target", serverUrl: "https://example.test", userId: "user", userName: "User", token: "token",
    userDataPath: "/unused", onConversationPresenceChanged(event: unknown) { presences.push(event) }, onDataChanged(event: { domains: string[] }) { changes.push(event) }, onSyncStateChange: ({ state }: { state: string }) => states.push(state),
  })
  return {
    runtime, critical, directory, messages, started, states, changes, presences,
    presence: (event: unknown) => applyPresence(event),
    online: () => online,
    isClosed: () => closed,
    snapshotCalls: () => snapshotCalls,
    finish: async () => {
      transport.resolve(); critical.resolve(); directory.resolve(); messages.resolve()
      await online?.catch((error) => { if (!closed) throw error })
      if (!closed) {
        assert.deepEqual(states, ["ready"])
        assert.equal(snapshotCalls, cached === false ? 2 : 1)
      }
      runtime.close()
    },
  }
}

test("Desktop有缓存时不等待首次网络快照或后台同步", { timeout: 2000 }, async () => {
  const h = harness(true)
  try {
    await h.runtime.initialize()
    assert.equal(h.runtime.listConversations()[0].id, "cached")
    assert.deepEqual(h.states, [])
    await h.runtime.initialize()
  } finally { await h.finish() }
})

test("Desktop空会话快照也是有效缓存，不等待网络", { timeout: 2000 }, async () => {
  const h = harness("empty")
  try {
    await h.runtime.initialize()
    assert.equal(h.runtime.listConversations().length, 0)
    assert.deepEqual(h.states, [])
  } finally { await h.finish() }
})

test("Desktop无缓存只等待会话快照，不等待全员资料或消息补追", { timeout: 2000 }, async () => {
  const h = harness(false)
  try {
    let ready = false
    const startup = h.runtime.initialize().then(() => { ready = true })
    await h.started.promise
    assert.equal(ready, false)
    h.critical.resolve()
    await startup
    assert.equal(h.runtime.listConversations()[0].id, "fresh")
    assert.deepEqual(h.states, [])
    await h.runtime.initialize()
  } finally { await h.finish() }
})

test("Desktop无缓存也不等待Socket握手，HTTP关键数据先完成即可进入", { timeout: 2000 }, async () => {
  const h = harness(false, false)
  try {
    const startup = h.runtime.initialize()
    await h.started.promise
    h.critical.resolve()
    await startup
    assert.equal(h.runtime.listConversations()[0].id, "fresh")
    assert.equal(h.snapshotCalls(), 1)
    assert.deepEqual(h.states, [])
  } finally { await h.finish() }
})

test("后台资料同步失败时仍通知已落库消息，不能只更新左侧摘要而遗漏右侧", { timeout: 2000 }, async () => {
  const h = harness(true)
  try {
    await h.runtime.initialize()
    h.critical.resolve()
    h.messages.resolve()
    const failure = new AuthFailure("http_500", "资料同步失败")
    h.directory.reject(failure)
    await assert.rejects(h.online(), (error) => error === failure)
    assert.ok(h.changes.some((event) => event.domains.includes("conversations")))
    assert.ok(h.changes.some((event) => event.domains.includes("messages")), "部分任务失败不能取消其他已完成消息的通知")
    assert.deepEqual(h.states, [], "不能把同步失败伪装成全部成功")
  } finally { h.runtime.close(); await h.finish() }
})

test("Runtime状态通道无需等待补同步，关闭账号后旧状态不能再投递", { timeout: 2000 }, async () => {
  const h = harness(true)
  try {
    await h.runtime.initialize()
    h.presence({ name: "conversation.status", payload: { conversation_id: "cached", status: "正在运行", sender: { type: "app", id: "app" } } })
    assert.equal(h.presences.length, 1)
    h.presence({ name: "message.created", payload: { message: { conversation_id: "cached", sender: { type: "app", id: "app" } } } })
    assert.equal(h.presences.length, 2)
    h.runtime.close()
    h.presence({ name: "conversation.status", payload: { conversation_id: "cached", status: "正在运行", sender: { type: "app", id: "app" } } })
    assert.equal(h.presences.length, 2)
  } finally { h.runtime.close(); await h.finish() }
})

test("Desktop首次关键快照身份失败仍拒绝进入主界面", { timeout: 2000 }, async () => {
  const h = harness(false)
  try {
    const startup = h.runtime.initialize()
    await h.started.promise
    const failure = new AuthFailure("unauthorized", "登录已失效")
    h.critical.reject(failure)
    await assert.rejects(startup, (error) => error === failure)
    assert.equal(h.isClosed(), true)
  } finally { await h.finish() }
})
