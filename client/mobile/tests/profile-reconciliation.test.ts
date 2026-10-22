import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { DirectorySynchronizer } from "../../shared/directory-sync.ts"
import * as entitySync from "../../shared/entity-sync.ts"
import { applyContactProfileBatch } from "../src/data/contacts/contact-profile-snapshot.ts"
import type { contactManager as Manager } from "../src/data/contacts/contact-manager.ts"
import type { createMobileEntitySync } from "../src/realtime/entity-sync.ts"

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {}
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, queueMicrotask, setTimeout, clearTimeout, require: (name: string) => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return exports
}

const target = { id: "server", url: "https://example.test", userId: "me" }
const user = (id: string, revision?: number) => ({
  id, type: "user" as const, name: id, nickname: "", avatar: "", email: `${id}@example.test`, phone: "",
  online: true, lastOnlineAt: null, updatedAt: "2026-10-21T00:00:00Z", entityRevision: revision,
})
type Profile = ReturnType<typeof user>
type Row = { profile: Profile; cached_at: number; missing_until: null }

function fixture(count = 1322) {
  const ids = ["me", ...Array.from({ length: count - 1 }, (_, i) => `user-${i}`)]
  const rows = new Map<string, Row>()
  let directory = { userIds: ids, apps: [{ id: "app", name: "App" }], groups: [{ id: "group", name: "Group", joined: true }] }
  const requests: string[][] = []
  let resolveProfiles = async (batch: string[]) => batch.map((id) => user(id))
  const manager = load("../src/data/contacts/contact-manager.ts", {
    "@/data/contacts/contacts-api": { fetchContacts: async () => directory },
    "@/data/contacts/contact-profile-snapshot": { applyContactProfileBatch },
    "@/data/contacts/contact-cache-store": {
      readContactDirectory: async () => directory,
      readUserProfiles: async (_target: unknown, batch?: string[]) => new Map([...rows].filter(([id]) => !batch || batch.includes(id))),
      replaceContactDirectory: async (_target: unknown, next: typeof directory) => { directory = next },
      mergeUserProfiles: async (_target: unknown, profiles: Profile[]) => {
        for (const profile of profiles) {
          if ((rows.get(profile.id)?.profile.entityRevision ?? 0) > (profile.entityRevision ?? 0)) continue
          rows.set(profile.id, { profile, cached_at: Date.now(), missing_until: null })
        }
      },
    },
    "@/data/server-key": { createServerKey: () => "server" },
    "@/data/users/user-profiles-api": { resolveClientUsers: async (_target: unknown, batch: string[]) => {
      requests.push([...batch])
      return resolveProfiles(batch)
    } },
    "../../../../shared/entity-sync": entitySync,
  }).contactManager as typeof Manager
  return { manager, rows, requests, setResolver: (resolve: typeof resolveProfiles) => { resolveProfiles = resolve } }
}

test("Mobile冷启动和缓存重连均只获取一轮用户资料，实体接口仅补群权限", async (t) => {
  const { manager, rows, requests } = fixture()
  const entities: entitySync.EntityReference[][] = []
  const permissions: string[] = []
  const create = load("../src/realtime/entity-sync.ts", {
    "../../../shared/directory-sync": { DirectorySynchronizer },
    "../../../shared/entity-sync": entitySync,
    "@/data/contacts": { contactManager: manager },
    "@/data/contacts/entity-sync-api": { resolveClientEntities: async (_target: unknown, batch: entitySync.EntityReference[]) => {
      entities.push(JSON.parse(JSON.stringify(batch)))
      return { users: [], apps: [], groups: [{ id: "group", name: "Latest", joined: true }], conversations: [{ id: "group" }], versions: { "group:group": 2 }, removed: [] }
    } },
    "@/data/conversations": { conversationManager: {
      beginOperation: () => 1, list: async () => [], applyEntity: async (_target: unknown, value: { id: string }) => { permissions.push(value.id) },
    } },
    "@/data/query": { queryKeys: { currentUser: () => ["me"] } },
    "@/data/messages/message-manager": {},
  }).createMobileEntitySync as typeof createMobileEntitySync
  const sync = create({ setQueryData: () => undefined, invalidateQueries: async () => undefined } as never, target, { isCurrent: () => true, onError: assert.fail })
  t.after(() => sync.dispose())
  const first = sync.reconcile()
  assert.equal(sync.reconcile(), first)
  await first
  assert.equal(requests.length, 14)
  assert.equal(requests.flat().length, 1322)
  assert.deepEqual(entities, [[{ type: "group", id: "group" }]])
  assert.deepEqual(permissions, ["group"])
  for (const row of rows.values()) row.cached_at = Date.now() - 1000
  await sync.reconcile()
  assert.equal(requests.length, 28)
  assert.equal(requests.slice(14).flat().length, 1322)
  assert.deepEqual(entities[1], [{ type: "group", id: "group" }])
  assert.equal((await manager.getSnapshot(target)).usersById.me?.online, true)
})

test("Mobile本轮已获取的资料可复用，后续明确刷新仍能重新获取", async () => {
  const { manager, requests } = fixture(2)
  const startedAt = Date.now()
  await manager.ensureUsers(target, ["me", "user-0"])
  await manager.refreshUsers(target, ["me", "user-0"], startedAt)
  assert.equal(requests.length, 1)
  await manager.refreshUsers(target, ["me", "user-0"])
  assert.equal(requests.length, 2)
})

test("Mobile复用普通资料接口时保留实体版本，进行中的旧响应不能覆盖实时新版本", async () => {
  const { manager, rows, setResolver } = fixture(1)
  rows.set("me", { profile: user("me", 3), cached_at: 1, missing_until: null })
  let finish!: (profiles: Profile[]) => void
  let started!: () => void
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  setResolver(async () => { started(); return new Promise((resolve) => { finish = resolve }) })
  const work = manager.refreshUsers(target, ["me"])
  await requestStarted
  rows.set("me", { profile: { ...user("me", 4), name: "New" }, cached_at: Date.now(), missing_until: null })
  finish([{ ...user("me"), name: "Old" }])
  await work
  assert.equal((await manager.getSnapshot(target)).usersById.me?.name, "New")
  assert.equal(rows.get("me")?.profile.entityRevision, 4)
  setResolver(async () => [{ ...user("me"), name: "Fresh" }])
  await manager.refreshUsers(target, ["me"])
  assert.equal(rows.get("me")?.profile.name, "Fresh")
  assert.equal(rows.get("me")?.profile.entityRevision, 4)
})
