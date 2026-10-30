import assert from "node:assert/strict"
import test from "node:test"
import { GROUP_PROFILE_CACHE_TTL_MS, GroupProfileSyncCache, isGroupProfileFresh } from "../../shared/group-profile-sync-cache.ts"
import { EntitySynchronizer } from "../../shared/entity-sync.ts"

test("群缓存只复用完整资料，60分钟边界及未来时间均过期", () => {
  const now = GROUP_PROFILE_CACHE_TTL_MS * 2
  assert.equal(isGroupProfileFresh({ id: "g", syncedAt: now - 1, hasSnapshot: true }, now), true)
  for (const state of [undefined, { id: "g", syncedAt: now, hasSnapshot: false },
    { id: "g", syncedAt: now - GROUP_PROFILE_CACHE_TTL_MS, hasSnapshot: true },
    { id: "g", syncedAt: now + 1, hasSnapshot: true }]) assert.equal(isGroupProfileFresh(state, now), false)
})

test("初始化复用时间，显式进群强刷；同步失败不续期，事件失效不被旧响应续期", async (t) => {
  let now = 10_000, current = true, requests = 0, fail = false
  const states = new Map([["g", now]])
  const cache = new GroupProfileSyncCache({
    now: () => now, isCurrent: () => current, onError: assert.fail,
    read: async (ids) => ids.filter((id) => states.has(id)).map((id) => ({ id, syncedAt: states.get(id)!, hasSnapshot: true })),
    write: async (ids, at) => { for (const id of ids) states.set(id, at) },
    remove: async (ids) => { for (const id of ids) states.delete(id) },
  })
  const sync = new EntitySynchronizer({
    groupCache: cache, isCurrent: () => current, onError: () => undefined,
    resolve: async () => { requests++; if (fail) throw new Error("offline"); return { revision: 1 } },
    version: (snapshot) => snapshot.revision, apply: async () => undefined,
  })
  t.after(() => sync.dispose())
  const group = { type: "group" as const, id: "g" }
  await sync.refresh([group], { useCache: true })
  assert.equal(requests, 0)
  now++
  await sync.refresh([group])
  assert.equal(requests, 1)
  assert.equal(states.get("g"), now)
  fail = true
  now++
  await assert.rejects(sync.refresh([group]), /offline/)
  assert.equal(states.get("g"), now - 1)
  const checkpoint = cache.checkpoint(["g"])
  cache.invalidate("g")
  await cache.synced(["g"], checkpoint, () => true)
  assert.deepEqual(await cache.stale(["g"]), ["g"])
  current = false
  await cache.synced(["g"], cache.checkpoint(["g"]), () => true)
  assert.equal(states.has("g"), false)
})

test("初始化与进群重叠只请求一次，完成后再次进入仍强制刷新", async (t) => {
  let finish!: (value: number) => void
  let requests = 0
  const sync = new EntitySynchronizer({
    isCurrent: () => true, onError: assert.fail,
    resolve: () => { requests++; return new Promise<number>((resolve) => { finish = resolve }) },
    version: (snapshot) => snapshot, apply: async () => undefined,
  })
  t.after(() => sync.dispose())
  const group = { type: "group" as const, id: "g" }
  const first = sync.refresh([group])
  const second = sync.refresh([group])
  finish(1)
  await Promise.all([first, second])
  assert.equal(requests, 1)
  const third = sync.refresh([group])
  finish(1)
  await third
  assert.equal(requests, 2)
})

test("实时变更绕过新鲜缓存，移除不记录成功时间", async (t) => {
  let saved = 0, invalidations = 0
  const cache = new GroupProfileSyncCache({
    isCurrent: () => true, onError: assert.fail,
    read: async () => [{ id: "g", syncedAt: Date.now(), hasSnapshot: true }],
    write: async () => { saved++ }, remove: async () => { invalidations++ },
  })
  let removed = false, requests = 0
  const sync = new EntitySynchronizer({
    groupCache: cache, isCurrent: () => true, onError: assert.fail,
    resolve: async () => { requests++; return 2 },
    version: (snapshot) => removed ? null : snapshot, apply: async () => undefined,
  })
  t.after(() => sync.dispose())
  sync.notify("conversation.members.updated", { conversation_id: "g", revision: 2 })
  await sync.flush()
  assert.equal(requests, 1)
  assert.equal(saved, 1)
  assert.equal(invalidations, 1)
  removed = true
  sync.forget({ type: "group", id: "g" })
  await sync.refresh([{ type: "group", id: "g" }])
  assert.equal(saved, 1)
  assert.equal(invalidations, 2)
})
