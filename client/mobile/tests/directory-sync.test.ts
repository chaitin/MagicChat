import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { DirectorySynchronizer, directoryUpdatedEvent } from "../../shared/directory-sync.ts"
import * as entitySync from "../../shared/entity-sync.ts"

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("目录通知合并突发事件，相同实体版本不能吞掉另一条新增通知", async (t) => {
  let requests = 0
  const sync = new DirectorySynchronizer({ isCurrent: () => true, onError: assert.fail, refresh: async () => { requests++ } })
  t.after(() => sync.dispose())
  assert.equal(sync.notify(directoryUpdatedEvent, { scope: "users", revision: 0 }), false)
  assert.equal(sync.notify(directoryUpdatedEvent, { scope: "unknown", revision: 1 }), false)
  assert.equal(sync.notify(directoryUpdatedEvent, { scope: "users", revision: "1" }), false)
  assert.equal(sync.notify("user.profile.updated", { scope: "users", revision: 1 }), false)
  assert.equal(sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 }), true)
  sync.notify(directoryUpdatedEvent, { scope: "apps", revision: 1 })
  sync.notify(directoryUpdatedEvent, { scope: "users", revision: 2 })
  await settle()
  assert.equal(requests, 1)
  sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 })
  await settle()
  assert.equal(requests, 2)
})

test("目录请求期间到达的新注册和新应用只补追一轮", async (t) => {
  const first = deferred<void>()
  let requests = 0
  const sync = new DirectorySynchronizer({ isCurrent: () => true, onError: assert.fail, refresh: async () => {
    if (++requests === 1) await first.promise
  } })
  t.after(() => sync.dispose())
  const work = sync.refresh()
  sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 })
  sync.notify(directoryUpdatedEvent, { scope: "apps", revision: 1 })
  first.resolve()
  await work
  assert.equal(requests, 2)
})

test("目录刷新失败自动重试，恢复刷新不必等待退避计时器", async (t) => {
  let attempts = 0
  const errors: unknown[] = []
  const sync = new DirectorySynchronizer({ isCurrent: () => true, onError: (error) => errors.push(error), refresh: async () => {
    if (++attempts === 1) throw new Error("offline")
  } })
  t.after(() => sync.dispose())
  sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 })
  await settle()
  assert.equal(errors.length, 1)
  await sync.refresh()
  assert.equal(attempts, 2)

  let retries = 0
  const recovered = deferred<void>()
  const retrying = new DirectorySynchronizer({ isCurrent: () => true, retryDelayMs: 1, onError: () => undefined, refresh: async () => {
    if (++retries === 1) throw new Error("offline")
    recovered.resolve()
  } })
  t.after(() => retrying.dispose())
  retrying.notify(directoryUpdatedEvent, { scope: "apps", revision: 1 })
  await recovered.promise
  assert.equal(retries, 2)
})

test("切换账号或卸载后不再补追旧目录", async () => {
  for (const action of ["switch", "dispose"]) {
    const first = deferred<void>()
    let current = true
    let requests = 0
    const sync = new DirectorySynchronizer({ isCurrent: () => current, onError: assert.fail, refresh: async () => { requests++; await first.promise } })
    const work = sync.refresh()
    sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 })
    if (action === "switch") current = false
    else sync.dispose()
    first.resolve()
    await work
    await sync.refresh()
    assert.equal(requests, 1)
    sync.dispose()
  }
})

function loadModule(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {}
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: (name: string) => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return exports
}

test("Mobile目录事件发现新ID后立即补资料，绕过激活前的负缓存", async (t) => {
  const finished = deferred<void>()
  const calls: string[] = []
  const snapshot = { directory: { userIds: ["new-user"], apps: [], groups: [] }, usersById: {}, unavailableUserIds: new Set(["new-user"]) }
  const module = loadModule("../src/realtime/entity-sync.ts", {
    "../../../shared/directory-sync": { DirectorySynchronizer },
    "../../../shared/entity-sync": entitySync,
    "@/data/contacts": { contactManager: {
      refresh: async () => { calls.push("directory"); return snapshot },
      refreshUsers: async (_target: unknown, ids: string[]) => { calls.push(`force:${ids.join(",")}`) },
      ensureUsers: async (_target: unknown, ids: string[]) => { calls.push(`ensure:${ids.join(",")}`); finished.resolve() },
    } },
    "@/data/contacts/entity-sync-api": {}, "@/data/conversations": {}, "@/data/query": {}, "@/data/messages/message-manager": {},
  })
  const create = module.createMobileEntitySync as (...args: unknown[]) => { notify: (event: string, payload: unknown) => boolean; dispose: () => void }
  const sync = create({}, { userId: "me" }, { isCurrent: () => true, onError: assert.fail })
  t.after(() => sync.dispose())
  assert.equal(sync.notify(directoryUpdatedEvent, { scope: "users", revision: 1 }), true)
  await finished.promise
  assert.deepEqual(calls, ["directory", "force:new-user", "ensure:new-user"])
})

test("Mobile资料事件不能让目录刷新静默丢掉新注册ID", async () => {
  const first = deferred<unknown>()
  const started = deferred<void>()
  let requests = 0
  let stored = { userIds: [] as string[], apps: [], groups: [] as { id: string; name: string }[] }
  const module = loadModule("../src/data/contacts/contact-manager.ts", {
    "@/data/contacts/contacts-api": { fetchContacts: async () => {
      if (++requests === 1) { started.resolve(); return first.promise }
      return { ...stored, userIds: ["new-user"] }
    } },
    "@/data/contacts/contact-profile-snapshot": {},
    "@/data/contacts/contact-cache-store": {
      readContactDirectory: async () => stored,
      readUserProfiles: async () => new Map(),
      replaceContactDirectory: async (_target: unknown, directory: typeof stored) => { stored = directory },
    },
    "@/data/server-key": { createServerKey: () => "server" },
    "@/data/users/user-profiles-api": {},
    "../../../../shared/entity-sync": entitySync,
  })
  const manager = module.contactManager as {
    refresh: (target: unknown) => Promise<{ directory: typeof stored }>
    upsertGroup: (target: unknown, group: { id: string; name: string }) => Promise<unknown>
  }
  const target = { userId: "me" }
  const work = manager.refresh(target)
  await started.promise
  await manager.upsertGroup(target, { id: "group", name: "Latest" })
  first.resolve({ userIds: [], apps: [], groups: [] })
  const snapshot = await work
  assert.equal(requests, 2)
  assert.equal(snapshot.directory.userIds.join(","), "new-user")
  assert.equal(snapshot.directory.groups[0]?.name, "Latest")
})
