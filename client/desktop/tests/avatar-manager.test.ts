import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"
import type { AvatarCacheRecord, AvatarDescriptor } from "../src/main/account/avatar-types.ts"

const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), "dianbao-avatar-tests-"))
after(() => rm(bundleDirectory, { recursive: true, force: true }))
await build({
  configFile: false,
  logLevel: "silent",
  build: {
    lib: {
      entry: fileURLToPath(new URL("../src/main/account/avatar-manager.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "avatar-manager.mjs",
    },
    outDir: bundleDirectory,
    emptyOutDir: false,
    rollupOptions: { external: [/^node:/] },
  },
})
const { AvatarManager } = (await import(
  pathToFileURL(path.join(bundleDirectory, "avatar-manager.mjs")).href
)) as typeof import("../src/main/account/avatar-manager.ts")

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dianbao-avatar-manager-"))
  const records = new Map<string, AvatarCacheRecord>()
  let descriptor: AvatarDescriptor | undefined
  let refreshCount = 0
  let downloadCount = 0
  let failRefresh = false
  let expectedAvatar = "/avatars/project-member.png"
  let waitForDownload: Promise<void> | undefined
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const manager = new AvatarManager(
    directory,
    "https://chat.example.test",
    {
      getAvatarCache: (type: string, id: string) => records.get(`${type}:${id}`),
      getAvatarCacheByResourceKey: (key: string) =>
        [...records.values()].find((record) => record.resourceKey === key),
      upsertAvatarCache: (record: AvatarCacheRecord) =>
        records.set(`${record.type}:${record.entityId}`, record),
    } as never,
    {
      downloadAvatar: async (url: string) => {
        assert.equal(url, `https://chat.example.test${expectedAvatar}`)
        downloadCount += 1
        const waiting = waitForDownload
        await waiting
        return { bytes, contentType: "image/png" }
      },
    } as never,
    {} as never,
    {
      getAvatarDescriptor: () => descriptor,
      hydrateAvatarDescriptor: (value: AvatarDescriptor) => value,
      refreshAvatarDescriptor: async (type: string, id: string) => {
        assert.equal(type, "user")
        assert.equal(id, "project-member")
        refreshCount += 1
        if (failRefresh) throw new Error("network unavailable")
        descriptor = {
          type: "user",
          id,
          name: "项目成员",
          avatarUrl: expectedAvatar,
        }
        return descriptor
      },
    } as never,
    {} as never,
    { type: "user", id: "me", name: "我", avatarUrl: "" },
  )
  return {
    manager,
    bytes,
    counts: () => ({ refreshCount, downloadCount }),
    records,
    setAvatar: (avatarUrl: string) => {
      expectedAvatar = avatarUrl
      descriptor = { type: "user", id: "project-member", name: "项目成员", avatarUrl }
    },
    setDownloadWait: (waiting?: Promise<void>) => { waitForDownload = waiting },
    failRefresh: () => {
      failRefresh = true
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

const request = { type: "user", id: "project-member", theme: "light" } as const

test("资料URL变化立即替换24小时内的头像缓存，无需额外刷新资料", async (t) => {
  const fixture = await setup()
  t.after(fixture.cleanup)
  const first = await fixture.manager.getAvatar(request)
  fixture.setAvatar("/avatars/new.png")
  fixture.manager.markChanged("user", "project-member")
  const next = await fixture.manager.getAvatar(request)
  assert.equal(next.status, "ready")
  assert.notDeepEqual(next, first)
  assert.deepEqual(fixture.counts(), { refreshCount: 1, downloadCount: 2 })
  assert.equal(fixture.records.get("user:project-member")?.sourceUrl, "https://chat.example.test/avatars/new.png")
})

test("头像下载期间收到新版本，旧下载不能覆盖新文件记录", async (t) => {
  const fixture = await setup()
  t.after(fixture.cleanup)
  let release!: () => void
  fixture.setAvatar("/avatars/old.png")
  fixture.setDownloadWait(new Promise<void>((resolve) => { release = resolve }))
  const stale = fixture.manager.getAvatar(request)
  while (!fixture.counts().downloadCount) await new Promise((resolve) => setImmediate(resolve))
  fixture.setAvatar("/avatars/latest.png")
  fixture.setDownloadWait()
  fixture.manager.markChanged("user", "project-member")
  const latest = await fixture.manager.getAvatar(request)
  release()
  await stale
  assert.equal(latest.status, "ready")
  assert.equal(fixture.records.get("user:project-member")?.sourceUrl, "https://chat.example.test/avatars/latest.png")
})

test("九宫格随成员头像及角色顺序变化，不等待24小时缓存过期", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dianbao-group-avatar-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const records = new Map<string, AvatarCacheRecord>()
  let members = [
    { type: "user" as const, id: "u1", name: "One", avatarUrl: "/one.png", role: "member" as const },
    { type: "user" as const, id: "u2", name: "Two", avatarUrl: "/two.png", role: "member" as const },
  ] as NonNullable<AvatarDescriptor["members"]>
  const descriptor = () => ({ type: "group" as const, id: "g1", name: "Group", avatarUrl: "", members })
  const manager = new AvatarManager(directory, "https://chat.example.test", {
    deleteAvatarCache: (type: string, id: string) => records.delete(`${type}:${id}`),
    getAvatarCache: (type: string, id: string) => records.get(`${type}:${id}`),
    getAvatarCacheByResourceKey: (key: string) => [...records.values()].find((record) => record.resourceKey === key),
    upsertAvatarCache: (record: AvatarCacheRecord) => records.set(`${record.type}:${record.entityId}`, record),
  } as never, {
    downloadAvatar: async () => ({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" }),
  } as never, {} as never, {
    getAvatarDescriptor: descriptor,
    hydrateAvatarDescriptor: (value: AvatarDescriptor) => value,
  } as never, {} as never, { type: "user", id: "me", name: "Me", avatarUrl: "" })
  const request = { type: "group", id: "g1", theme: "light" } as const
  const first = await manager.getAvatar(request)
  members = members.map((member) => member.id === "u2" ? { ...member, avatarUrl: "/new-two.png", role: "admin" } : member)
  manager.markChanged("user", "u2")
  manager.markChanged("group", "g1")
  const second = await manager.getAvatar(request)
  assert.equal(second.status, "ready")
  assert.notDeepEqual(first, second)
  assert.equal(records.get("user:u2")?.sourceUrl, "https://chat.example.test/new-two.png")
})

test("项目成员不在本地通讯录时仍获取资料、下载真实头像并复用缓存", async () => {
  const fixture = await setup()
  try {
    const [first, concurrent] = await Promise.all([
      fixture.manager.getAvatar(request),
      fixture.manager.getAvatar(request),
    ])
    assert.equal(first.status, "ready")
    assert.deepEqual(first, concurrent)
    assert.deepEqual(fixture.counts(), { refreshCount: 1, downloadCount: 1 })
    if (first.status !== "ready") throw new Error("未返回真实头像")
    assert.ok(first.resourceUrl)
    const resourceKey = new URL(first.resourceUrl).pathname.slice(1)
    const resource = await fixture.manager.readResource(resourceKey)
    assert.equal(resource.contentType, "image/png")
    assert.deepEqual(resource.bytes, fixture.bytes)
    assert.deepEqual(await fixture.manager.getAvatar(request), first)
    assert.deepEqual(fixture.counts(), { refreshCount: 1, downloadCount: 1 })
  } finally {
    await fixture.cleanup()
  }
})

test("仅缓存头像请求不会为缺少本地资料的用户发起网络请求", async () => {
  const fixture = await setup()
  try {
    assert.deepEqual(await fixture.manager.getAvatar({ ...request, cacheOnly: true }), {
      status: "fallback",
      type: "user",
    })
    assert.deepEqual(fixture.counts(), { refreshCount: 0, downloadCount: 0 })
  } finally {
    await fixture.cleanup()
  }
})

test("项目成员头像资料获取失败时安全回退，不下载错误头像", async () => {
  const fixture = await setup()
  try {
    fixture.failRefresh()
    assert.deepEqual(await fixture.manager.getAvatar(request), {
      status: "fallback",
      type: "user",
    })
    assert.deepEqual(fixture.counts(), { refreshCount: 1, downloadCount: 0 })
  } finally {
    await fixture.cleanup()
  }
})
