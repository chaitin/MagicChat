import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerHooks } from "node:module"
import test from "node:test"
import ts from "typescript"
import { GroupProfileSyncCache } from "../../shared/group-profile-sync-cache.ts"
import { createDesktopEntitySync } from "../src/main/account/entity-sync.ts"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.startsWith(".") && (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!url.endsWith(".ts")) return loaded
    return { ...loaded, format: "module", shortCircuit: true,
      source: ts.transpileModule(String(loaded.source), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }
  },
})
const { AccountDatabase } = await import("../src/main/account/account-database.ts")

test("Desktop重启保留群时间，账号数据库隔离，删除或不完整资料不能复用", async () => {
  const directory = mkdtempSync(join(tmpdir(), "group-profile-cache-"))
  const path = join(directory, "account.sqlite")
  let db = new AccountDatabase(path)
  const other = new AccountDatabase(":memory:")
  try {
    db.upsertCurrentConversations([{
      id: "g", type: "group", name: "Group", memberCount: 0, avatar: "", avatarType: "group", avatarId: "g",
      createdAt: "", lastMessageAt: null, lastMessageSummary: "", pinned: false, unreadCount: 0,
      notificationMuted: false, isBuiltinAssistant: false, payload: { id: "g", type: "group", members: [] },
    }])
    db.markGroupProfilesSynced(["g"], Date.now())
    db.close()
    db = new AccountDatabase(path)
    assert.equal(db.getGroupProfileSyncStates(["g"])[0]?.hasSnapshot, true)
    assert.deepEqual(other.getGroupProfileSyncStates(["g"]), [])
    const cache = new GroupProfileSyncCache({
      read: async (ids) => db.getGroupProfileSyncStates(ids),
      write: async (ids, at) => db.markGroupProfilesSynced(ids, at),
      remove: async (ids) => db.invalidateGroupProfiles(ids),
      isCurrent: () => true, onError: (error) => assert.fail(String(error)),
    })
    let requests = 0
    const sync = createDesktopEntitySync({
      groupCache: cache, database: db,
      contacts: { refresh: async () => undefined, getDirectory: () => ({ users: [{ id: "me" }], apps: [], groups: [{ id: "g", joined: true }] }),
        getAvatarDescriptor: () => undefined, groupsUsingAvatar: () => [], applyEntities: () => undefined,
        resolveEntities: async () => { requests++; return { users: [], apps: [], groups: [], conversations: [], versions: {}, removed: [] } } },
      avatars: { markChanged: () => undefined }, conversations: { removeEntity: () => undefined },
      currentUser: { type: "user", id: "me" }, isCurrent: () => true, onError: assert.fail, onChanged: () => undefined,
    } as never)
    try {
      await sync.reconcile()
      assert.equal(requests, 0)
      await sync.refreshGroup("g")
      assert.equal(requests, 1)
      cache.invalidate("g")
      assert.deepEqual(await cache.stale(["g"]), ["g"])
    } finally { sync.dispose() }
  } finally { db.close(); other.close(); rmSync(directory, { recursive: true, force: true }) }
})
