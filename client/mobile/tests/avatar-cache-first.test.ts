import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import type { ResolvedResource } from "@/core/resource-models"
import { SharedTaskPool } from "@/data/resources/shared-task-pool"

const server = { id: "test-server", url: "https://example.test" }
const reference = { type: "avatar" as const, url: "https://example.test/avatar.webp" }
const old: ResolvedResource = { checkedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, identity: `avatar:${reference.url}`, uri: "file:///cache/old.webp", sizeBytes: 10, source: "cache" }
const fresh: ResolvedResource = { ...old, checkedAt: Date.now(), uri: "file:///cache/new.webp", source: "network" }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function load(path: string, dependencies: Record<string, unknown>, suffix = "") {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(`${code}\n${suffix}`, { exports, URL, require(name: string) {
    if (!(name in dependencies)) throw new Error(`unexpected import ${name}`)
    return dependencies[name]
  } })
  return exports
}

function repository(cached: ResolvedResource | null) {
  let reads = 0
  const downloads: { resolve: () => void; reject: (error: Error) => void }[] = []
  const api = load("data/resources/resource-repository.ts", {
    "react-native": { Platform: { OS: "android" } },
    "@/data/resources/attachment-resource-memory": {},
    "@/data/resources/resource-cache-store": {
      getCachedResource: async () => { reads++; return cached },
      createResourceCacheTarget: async () => ({ temporaryFile: {} }),
      commitResourceCacheTarget: async () => { cached = { ...fresh, source: "cache" }; return fresh },
    },
    "@/data/resources/resource-downloader": { downloadResource: () => new Promise((resolve, reject) => downloads.push({ resolve: () => resolve({ sizeBytes: 10 }), reject })) },
    "@/data/resources/resource-file-extension": {},
    "@/data/resources/resource-request-pool": {},
    "@/data/resources/shared-task-pool": { SharedTaskPool },
    "@/lib/server-asset-url": { resolveServerAssetUrl: (_base: string, avatar: string) => avatar },
  })
  return { api, downloads, reads: () => reads }
}

test("过期或旧版头像缓存立即返回，仅检查一次磁盘且不等待网络", async () => {
  for (const cached of [old, { ...old, checkedAt: undefined }]) {
    const { api, downloads, reads } = repository(cached)
    assert.equal(await api.ensureAvatarResource(server, reference, { cacheFirst: true }), cached)
    assert.equal(reads(), 1)
    assert.equal(downloads.length, 0)
  }
})

test("新鲜缓存只读取一次，不重复下载", async () => {
  const cached = { ...old, checkedAt: Date.now() }
  const { api, downloads, reads } = repository(cached)
  assert.equal(await api.ensureAvatarResource(server, reference), cached)
  assert.equal(reads(), 1)
  assert.equal(downloads.length, 0)
})

test("过期缓存后台刷新合并重复下载，失败仍返回旧图", async () => {
  const { api, downloads } = repository(old)
  const first = api.ensureAvatarResource(server, reference)
  const second = api.ensureAvatarResource(server, reference)
  await flush()
  assert.equal(downloads.length, 1)
  downloads[0].reject(new Error("offline"))
  assert.equal(await first, old)
  assert.equal(await second, old)
})

test("没有缓存时正常下载，强制修复不被缓存优先策略短路", async () => {
  for (const cached of [null, { ...old, checkedAt: Date.now() }]) {
    const { api, downloads } = repository(cached)
    const pending = api.ensureAvatarResource(server, reference, { cacheFirst: true, force: Boolean(cached) })
    await flush()
    assert.equal(downloads.length, 1)
    downloads[0].resolve()
    assert.equal(await pending, fresh)
  }
})

test("头像新鲜度识别缺失和无效时间戳", () => {
  const { api } = repository(null)
  assert.equal(api.isAvatarResourceFresh(old), false)
  assert.equal(api.isAvatarResourceFresh(fresh), true)
  assert.equal(api.isAvatarResourceFresh({ ...old, checkedAt: NaN }), false)
  assert.equal(api.isAvatarResourceFresh({ ...old, checkedAt: undefined }), false)
})

function avatarHook(initial: ResolvedResource | null) {
  let current: ResolvedResource | null | undefined = initial
  const effects: (() => void)[] = []
  const refreshes: { resolve: (value: ResolvedResource | null) => void; reject: (error: Error) => void }[] = []
  const queries: any[] = []
  const writes: unknown[] = []
  const client = { setQueryData(key: unknown, update: (value: typeof current) => typeof current) { current = update(current); writes.push(key) } }
  const api = load("data/resources/resource-hooks.ts", {
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: (options: unknown) => { queries.push(options); return { data: initial, isLoading: false, error: null } } },
    react: { useCallback: (fn: Function) => fn, useEffect: (effect: () => void) => effects.push(effect) },
    "@/data/query": { queryKeys: { avatarResource: (target: typeof server, url: string) => [target.id, target.url, url] } },
    "@/data/resources/resource-repository": {
      resolveAvatarResourceUrl: (_target: unknown, value: string) => value,
      isAvatarResourceFresh: (value: ResolvedResource) => typeof value.checkedAt === "number" && Date.now() - value.checkedAt < 24 * 60 * 60 * 1000,
      ensureAvatarResource: (_target: unknown, _ref: unknown, options?: { cacheFirst?: boolean }) => options?.cacheFirst ? Promise.resolve(initial) : new Promise((resolve, reject) => refreshes.push({ resolve, reject })),
    },
    "@/data/resources/attachment-resource-memory": {},
  })
  return { result: api.useCachedAvatar(server, reference.url), refreshes, queries, writes, runEffects: () => effects.forEach((effect) => effect()), current: () => current, replace: (value: typeof current) => { current = value } }
}

test("头像hook先展示旧URI，再将后台刷新结果写回同一共享查询", async () => {
  const hook = avatarHook(old)
  assert.equal(hook.result.uri, old.uri)
  assert.equal(await hook.queries[0].queryFn({ signal: undefined }), old)
  hook.runEffects()
  assert.equal(hook.refreshes.length, 1)
  assert.equal(hook.current(), old)
  hook.refreshes[0].resolve(fresh)
  await flush()
  assert.equal(hook.current(), fresh)
})

test("新鲜缓存和远程资源不启动后台文件刷新", () => {
  for (const resource of [{ ...old, checkedAt: Date.now() }, fresh, null]) {
    const hook = avatarHook(resource)
    hook.runEffects()
    assert.equal(hook.refreshes.length, 0)
  }
})

test("后台刷新失败保留缓存，不创建空白或错误状态", async () => {
  const hook = avatarHook(old)
  hook.runEffects()
  hook.refreshes[0].reject(new Error("offline"))
  await flush()
  assert.equal(hook.current(), old)
  assert.equal(hook.writes.length, 0)
})

test("刷新返回旧文件时不续期查询，过期头像允许下次聚焦重试", async () => {
  const hook = avatarHook(old)
  assert.equal(hook.queries[0].staleTime({ state: { data: old } }), 0)
  assert.equal(hook.queries[0].staleTime({ state: { data: fresh } }), 24 * 60 * 60 * 1000)
  hook.runEffects()
  hook.refreshes[0].resolve(old)
  await flush()
  assert.equal(hook.current(), old)
  assert.equal(hook.writes.length, 0)
})

test("后台刷新不能复活已清理的查询或覆盖更新的强制修复结果", async () => {
  for (const replacement of [undefined, { ...fresh, uri: "file:///cache/newer.webp" }]) {
    const hook = avatarHook(old)
    hook.runEffects()
    hook.replace(replacement)
    hook.refreshes[0].resolve(fresh)
    await flush()
    assert.equal(hook.current(), replacement)
  }
})

test("磁盘缓存及下载结果传出原有检查时间，命中缓存不延长有效期", async () => {
  let stored: string | null = null
  class Directory {
    uri: string
    exists = true
    constructor(...parts: any[]) { this.uri = parts.map(part => typeof part === "string" ? part : part.uri).join("/") }
    create() {}
    list() { return [] }
  }
  class File extends Directory {
    size = 10
    get name() { return this.uri.split("/").at(-1)! }
    delete() { this.exists = false }
    async move(destination: File) { destination.exists = true; this.uri = destination.uri }
  }
  const api = load("data/resources/resource-cache-store.ts", {
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => stored, setItem: async (_key: string, value: string) => { stored = value } } },
    "expo-file-system": { Directory, File, Paths: { cache: "file:///cache" } },
    "react-native": { Platform: { OS: "android" } },
  }, "exports.cacheKeys = (server, identity) => ({ serverKey: createServerKey(server), cacheId: createCacheId(createServerKey(server), identity) });")
  const { serverKey, cacheId } = api.cacheKeys(server, old.identity)
  stored = JSON.stringify({ version: 1, entries: { [cacheId]: { checkedAt: old.checkedAt, fileName: "old.webp", identity: old.identity, lastAccessedAt: 1, serverKey, sizeBytes: 10 } } })
  const cached = await api.getCachedResource(server, old.identity)
  assert.equal(cached.checkedAt, old.checkedAt)
  const before = Date.now()
  const target = await api.createResourceCacheTarget(server, old.identity, ".webp", { versioned: true })
  const downloaded = await api.commitResourceCacheTarget(target, 10)
  assert.ok(downloaded.checkedAt >= before && downloaded.checkedAt <= Date.now())
  assert.equal(downloaded.source, "network")
})
