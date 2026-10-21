import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { resolveEntityProfile, type EntityProfile } from "@/domain/entities/entity-profile"
import { selectEntityProfile } from "../../shared/entity-profile-result.ts"

const id = "550e8400-e29b-41d4-a716-446655440000"
const reference = { type: "group" as const, id }
const target = { id: "server", url: "https://example.test", userId: "me" }
const profile = (revision: number): EntityProfile => ({
  type: "group",
  id,
  displayName: `group-${revision}`,
  avatar: "",
  avatarMembers: [],
  joined: true,
  memberCount: 2,
  visibility: "public",
})
const snapshot = (revision: number, removed = false) => ({
  users: [],
  apps: [],
  groups: removed
    ? []
    : [
        {
          id,
          name: `group-${revision}`,
          avatar: "",
          avatarMembers: [],
          joined: true,
          memberCount: 2,
          visibility: "public",
        },
      ],
  conversations: [],
  removed: removed ? [reference] : [],
  versions: { [`group:${id}`]: revision },
})
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ReturnType<typeof snapshot>>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

type Result = {
  profile: EntityProfile | null
  loading: boolean
  unavailable: boolean
  error: Error | null
  retry: () => void
}
function fixture(
  resolve: () => Promise<ReturnType<typeof snapshot>>,
  initial: { cached?: EntityProfile | null; revision?: number } = {},
) {
  const states: unknown[] = [],
    refs: { current: unknown }[] = []
  const memos: { deps: unknown[]; value: unknown }[] = []
  const effects: { deps: unknown[]; cleanup?: () => void }[] = []
  let stateIndex = 0,
    refIndex = 0,
    memoIndex = 0,
    effectIndex = 0
  let dirty = true,
    pending: (() => void)[] = [],
    calls = 0
  let input = {
    target,
    reference,
    cached: profile(1) as EntityProfile | null,
    revision: 1,
    ...initial,
  }
  let result: Result
  const changed = (old: unknown[] | undefined, next: unknown[]) =>
    !old || next.some((value, index) => !Object.is(value, old[index]))
  const effect = (run: () => void | (() => void), deps: unknown[]) => {
    const index = effectIndex++
    if (!changed(effects[index]?.deps, deps)) return
    pending.push(() => {
      effects[index]?.cleanup?.()
      effects[index] = { deps, cleanup: run() || undefined }
    })
  }
  const exports = {} as { useEntityProfileLookup: (input: unknown) => Result }
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/features/entity-details/use-entity-profile-lookup.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText
  runInNewContext(code, {
    exports,
    Error,
    require(name: string) {
      if (name === "react")
        return {
          useState(initial: unknown) {
            const index = stateIndex++
            if (!(index in states)) states[index] = initial
            return [
              states[index],
              (value: unknown) => {
                states[index] = typeof value === "function" ? value(states[index]) : value
                dirty = true
              },
            ]
          },
          useRef(initial: unknown) {
            return refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial })
          },
          useCallback(value: unknown, deps: unknown[]) {
            const index = memoIndex++
            if (changed(memos[index]?.deps, deps)) memos[index] = { value, deps }
            return memos[index].value
          },
          useLayoutEffect: effect,
        }
      if (name === "expo-router")
        return { useFocusEffect: (run: () => void | (() => void)) => effect(run, [run]) }
      if (name.includes("entity-sync-api"))
        return {
          resolveClientEntities: () => {
            calls++
            return resolve()
          },
        }
      if (name.includes("entity-profile-result")) return { selectEntityProfile }
      if (name.includes("entity-profile")) return { resolveEntityProfile }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  function render(patch: Partial<typeof input> = {}) {
    input = { ...input, ...patch }
    dirty = true
    for (let count = 0; dirty && count < 10; count++) {
      dirty = false
      stateIndex = refIndex = memoIndex = effectIndex = 0
      pending = []
      result = exports.useEntityProfileLookup(input)
      pending.forEach((run) => run())
    }
    assert.equal(dirty, false, "Hook did not settle")
    return result!
  }
  return {
    render,
    calls: () => calls,
    async flush() {
      for (let count = 0; count < 8; count++) await Promise.resolve()
      return render()
    },
    unmount() {
      effects.forEach((item) => item.cleanup?.())
    },
  }
}

test("有缓存时立即展示，超时不伪装成无权限且保留缓存", async () => {
  const pending = deferred(),
    cached = profile(1)
  const f = fixture(() => pending.promise, { cached })
  assert.equal(f.render().profile, cached)
  pending.reject(new Error("offline"))
  const result = await f.flush()
  assert.equal(result.profile, cached)
  assert.equal(result.loading, false)
  assert.equal(result.unavailable, false)
  assert.equal(result.error?.message, "offline")
})

test("无缓存时网络失败可重试，成功后展示资料", async () => {
  let attempt = 0
  const f = fixture(
    async () => {
      if (++attempt === 1) throw new Error("offline")
      return snapshot(2)
    },
    { cached: null },
  )
  f.render()
  const failed = await f.flush()
  assert.equal(failed.error?.message, "offline")
  assert.equal(failed.unavailable, false)
  failed.retry()
  f.render()
  const success = await f.flush()
  assert.equal(success.profile?.displayName, "group-2")
  assert.equal(success.error, null)
  assert.equal(f.calls(), 2)
})

test("明确不可访问隐藏旧缓存，后续网络失败不能恢复已撤销资料", async () => {
  let attempt = 0
  const f = fixture(async () => {
    if (++attempt === 1) return snapshot(2, true)
    throw new Error("offline")
  })
  f.render()
  const removed = await f.flush()
  assert.equal(removed.profile, null)
  assert.equal(removed.unavailable, true)
  removed.retry()
  f.render()
  const retried = await f.flush()
  assert.equal(retried.profile, null)
  assert.equal(retried.unavailable, true)
  assert.equal(retried.error?.message, "offline")
})

test("较旧移除响应不隐藏较新实时资料", async () => {
  const pending = deferred(),
    f = fixture(() => pending.promise)
  f.render()
  const latest = profile(2)
  f.render({ cached: latest, revision: 2 })
  pending.resolve(snapshot(1, true))
  const result = await f.flush()
  assert.equal(result.profile, latest)
  assert.equal(result.unavailable, false)
})

test("实时同步移除后旧可见响应不能恢复资料", async () => {
  const pending = deferred(),
    f = fixture(() => pending.promise)
  f.render()
  f.render({ cached: null })
  pending.resolve(snapshot(1))
  assert.equal((await f.flush()).profile, null)
})

test("切账号后忽略旧响应，失焦后失败不再更新页面", async () => {
  const pending = deferred()
  let attempt = 0
  const f = fixture(
    () => (++attempt === 1 ? pending.promise : Promise.resolve(snapshot(2, true))),
    { cached: null },
  )
  f.render()
  f.render({ target: { ...target, userId: "other" } })
  pending.resolve(snapshot(1))
  assert.equal((await f.flush()).profile, null)
  assert.equal(f.calls(), 2)
  f.unmount()
})

test("资料查询不写共享通讯录，已有缓存仍可由实时同步继续更新", () => {
  const source = readFileSync(
    new URL("../src/features/entity-details/use-entity-profile-lookup.ts", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /applyEntities|applyEntitySnapshot/)
  const screen = readFileSync(
    new URL("../src/features/entity-details/entity-detail-screen.tsx", import.meta.url),
    "utf8",
  )
  assert.match(screen, /onPress={lookup.retry}/)
  assert.match(screen, /刷新失败，正在显示缓存资料/)
})
