import assert from "node:assert/strict"
import test from "node:test"
import { EntitySynchronizer, entityKey, parseEntityChange, readEntitySnapshot, type EntityReference } from "../../shared/entity-sync.ts"

const group: EntityReference = { type: "group", id: "group-1" }
type Snapshot = { revision: number; removed?: boolean }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

test("实体事件拒绝非法版本，保留旧用户资料事件的解析", () => {
  assert.equal(parseEntityChange("message.created", {}), null)
  assert.equal(parseEntityChange("conversation.updated", { conversation_id: "topic-1", reason: "topic.read_state.updated" }), null)
  assert.equal(parseEntityChange("conversation.updated", { conversation_id: "group-1", revision: -1 }), null)
  assert.equal(parseEntityChange("app.profile.updated", { app_id: "app-1", revision: Number.MAX_SAFE_INTEGER + 1 }), null)
  assert.deepEqual(parseEntityChange("user.profile.updated", { user_id: "user-1" }), { entity: { type: "user", id: "user-1" }, revision: 0 })
  assert.throws(() => readEntitySnapshot({ users: [], apps: [], groups: [], conversations: [], versions: { bad: "1" }, removed: [] }))
})

test("同一轮实体事件合并，重复及旧版本不会重复请求", async (t) => {
  let requests = 0
  const applied: number[] = []
  const sync = new EntitySynchronizer<Snapshot>({
    isCurrent: () => true, onError: assert.fail,
    resolve: async (entities) => { requests++; assert.equal(entities.length, 1); return { revision: 3 } },
    version: (snapshot) => snapshot.revision,
    apply: async (snapshot) => { applied.push(snapshot.revision) },
  })
  t.after(() => sync.dispose())
  sync.notify("conversation.updated", { conversation_id: group.id, revision: 1 })
  sync.notify("conversation.members.updated", { conversation_id: group.id, revision: 3 })
  await sync.flush()
  sync.notify("conversation.members.updated", { conversation_id: group.id, revision: 2 })
  sync.notify("conversation.updated", { conversation_id: group.id, revision: 3 })
  await sync.flush()
  assert.equal(requests, 1)
  assert.deepEqual(applied, [3])
})

test("请求期间收到新权限版本时丢弃旧快照并立即追到最新", async (t) => {
  const first = deferred<Snapshot>()
  const applied: number[] = []
  let requests = 0
  const sync = new EntitySynchronizer<Snapshot>({
    isCurrent: () => true, onError: assert.fail,
    resolve: async () => ++requests === 1 ? first.promise : { revision: 2 },
    version: (snapshot) => snapshot.revision,
    apply: async (snapshot, entities) => { if (entities.length) applied.push(snapshot.revision) },
  })
  t.after(() => sync.dispose())
  sync.notify("conversation.updated", { conversation_id: group.id, revision: 1 })
  const work = sync.flush()
  sync.notify("conversation.members.updated", { conversation_id: group.id, revision: 2 })
  first.resolve({ revision: 1 })
  await work
  assert.equal(requests, 2)
  assert.deepEqual(applied, [2])
})

test("暂时失败保留待同步版本并自动重试", async (t) => {
  let attempts = 0
  let complete!: () => void
  const applied = new Promise<void>((resolve) => { complete = resolve })
  const sync = new EntitySynchronizer<Snapshot>({
    isCurrent: () => true, onError: () => undefined, retryDelayMs: 1,
    resolve: async () => { if (++attempts === 1) throw new Error("offline"); return { revision: 2 } },
    version: (snapshot) => snapshot.revision,
    apply: async () => complete(),
  })
  t.after(() => sync.dispose())
  sync.notify("conversation.updated", { conversation_id: group.id, revision: 2 })
  await assert.rejects(sync.flush(), /offline/)
  await applied
  assert.equal(attempts, 2)
})

test("旧移除快照不能覆盖请求期间的新加入版本", async (t) => {
  const first = deferred<Snapshot>()
  let requests = 0
  const applied: Snapshot[] = []
  const sync = new EntitySynchronizer<Snapshot>({
    isCurrent: () => true, onError: assert.fail,
    resolve: async () => ++requests === 1 ? first.promise : { revision: 3 },
    version: (snapshot) => snapshot.removed ? null : snapshot.revision,
    apply: async (snapshot) => { applied.push(snapshot) },
  })
  t.after(() => sync.dispose())
  sync.notify("conversation.updated", { conversation_id: group.id, revision: 1 })
  const work = sync.flush()
  sync.notify("conversation.members.updated", { conversation_id: group.id, revision: 3 })
  first.resolve({ revision: 0, removed: true })
  await work
  assert.deepEqual(applied, [{ revision: 3 }])
})

test("移除会话或切换账号后，进行中的快照不能恢复旧权限", async (t) => {
  for (const action of ["remove", "switch"]) {
    const first = deferred<Snapshot>()
    let current = true
    const applied: EntityReference[] = []
    const sync = new EntitySynchronizer<Snapshot>({
      isCurrent: () => current, onError: assert.fail,
      resolve: () => first.promise,
      version: (snapshot) => snapshot.revision,
      apply: async (_snapshot, entities, isCurrent) => { applied.push(...entities.filter(isCurrent)) },
    })
    t.after(() => sync.dispose())
    sync.notify("conversation.updated", { conversation_id: group.id, revision: 1 })
    const work = sync.flush()
    if (action === "remove") sync.forget(group)
    else current = false
    first.resolve({ revision: 1 })
    await work
    assert.deepEqual(applied, [])
  }
})

test("重连强制对账已有实体，批次限制同时约束成员列表体积", async (t) => {
  const batches: EntityReference[][] = []
  const sync = new EntitySynchronizer<Snapshot>({
    isCurrent: () => true, onError: assert.fail,
    resolve: async (entities) => { batches.push(entities); return { revision: 2 } },
    version: (snapshot) => snapshot.revision,
    apply: async () => undefined,
  })
  t.after(() => sync.dispose())
  const entities: EntityReference[] = Array.from({ length: 205 }, (_, i) => ({ type: "user", id: `user-${i}` }))
  entities.push(...Array.from({ length: 9 }, (_, i) => ({ type: "group" as const, id: `group-${i}` })))
  await sync.refresh(entities)
  assert.equal(new Set(batches.flat().map(entityKey)).size, 214)
  assert.ok(batches.every((batch) => batch.length <= 100 && batch.filter((entity) => entity.type === "group").length <= 4))
  const previous = batches.length
  await sync.refresh([entities[0]!])
  assert.equal(batches.length, previous + 1)
})
