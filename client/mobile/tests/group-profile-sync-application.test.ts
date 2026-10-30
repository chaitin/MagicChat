import assert from "node:assert/strict"
import test from "node:test"
import { EntitySynchronizer } from "../../shared/entity-sync.ts"
import { GroupProfileSyncCache } from "../../shared/group-profile-sync-cache.ts"

test("旧版本或未完整应用的快照、持久化失败均不能推进群成功时间", async (t) => {
  let at = 1, accepted = false, fail = false
  const cache = new GroupProfileSyncCache({
    isCurrent: () => true, onError: () => undefined,
    read: async () => [{ id: "g", syncedAt: at, hasSnapshot: true }],
    write: async (_ids, now) => { if (fail) throw new Error("disk"); at = now },
    remove: async () => undefined, now: () => 100,
  })
  const sync = new EntitySynchronizer({
    groupCache: cache, isCurrent: () => true, onError: () => undefined,
    resolve: async () => 1, version: (version) => version,
    apply: async () => ({ syncedGroups: accepted ? ["g"] : [] }),
  })
  t.after(() => sync.dispose())
  const groups = [{ type: "group" as const, id: "g" }]
  await sync.refresh(groups)
  assert.equal(at, 1)
  accepted = true; fail = true
  await sync.refresh(groups)
  assert.equal(at, 1)
})

test("失效删除失败也不能复用旧缓存", async () => {
  const errors: unknown[] = []
  const cache = new GroupProfileSyncCache({
    isCurrent: () => true, onError: (error) => { errors.push(error) },
    read: async () => [{ id: "g", syncedAt: 100, hasSnapshot: true }],
    write: async () => undefined, remove: async () => { throw new Error("disk") }, now: () => 101,
  })
  cache.invalidate("g")
  assert.deepEqual(await cache.stale(["g"]), ["g"])
  assert.equal(errors.length, 1)
})

test("初始化读取旧缓存期间已完成进群刷新时，重新检查时间而不重复请求", async (t) => {
  let finishRead!: (states: { id: string; syncedAt: number; hasSnapshot: boolean }[]) => void
  let saved = 0, requests = 0, firstRead = true
  const cache = new GroupProfileSyncCache({
    isCurrent: () => true, onError: () => undefined, now: () => 100,
    read: async () => {
      if (firstRead) { firstRead = false; return new Promise((resolve) => { finishRead = resolve }) }
      return [{ id: "g", syncedAt: saved, hasSnapshot: true }]
    },
    write: async (_ids, at) => { saved = at }, remove: async () => undefined,
  })
  const sync = new EntitySynchronizer({
    groupCache: cache, isCurrent: () => true, onError: () => undefined,
    resolve: async () => { requests++; return 1 }, version: (value) => value, apply: async () => undefined,
  })
  t.after(() => sync.dispose())
  const groups = [{ type: "group" as const, id: "g" }]
  const initialization = sync.refresh(groups, { useCache: true })
  await Promise.resolve()
  await sync.refresh(groups)
  finishRead([{ id: "g", syncedAt: 0, hasSnapshot: false }])
  await initialization
  assert.equal(requests, 1)
})
