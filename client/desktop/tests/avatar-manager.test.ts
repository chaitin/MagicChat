import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"
import type { AvatarCacheRecord, AvatarDescriptor } from "../src/main/account/avatar-types.ts"
import type { AvatarResult } from "../src/shared/account-data.ts"

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

async function setupGroup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dianbao-group-recovery-"))
  const records = new Map<string, AvatarCacheRecord>()
  const failing = new Set<string>()
  const changes: Array<Array<{ type: "user" | "group" | "app"; id: string }>> = []
  const listeners = new Set<(changed: (typeof changes)[number]) => void>()
  let downloads = 0
  let members: NonNullable<AvatarDescriptor["members"]> = Array.from({ length: 9 }, (_, index) => ({
    type: "user", id: `u${index + 1}`, name: `成员${index + 1}`,
    avatarUrl: `/u${index + 1}.png`, role: index === 0 ? "owner" : "member",
  }))
  const manager = new AvatarManager(directory, "https://chat.example.test", {
    getAvatarCache: (type: string, id: string) => records.get(`${type}:${id}`),
    getAvatarCacheByResourceKey: (key: string) => [...records.values()].find((record) => record.resourceKey === key),
    deleteAvatarCache: (type: string, id: string) => {
      const key = `${type}:${id}`
      const record = records.get(key)
      records.delete(key)
      return record
    },
    upsertAvatarCache: (record: AvatarCacheRecord) => records.set(`${record.type}:${record.entityId}`, record),
  } as never, {
    downloadAvatar: async (url: string) => {
      downloads += 1
      if (failing.has(new URL(url).pathname)) throw new Error("temporary network failure")
      return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" }
    },
  } as never, {} as never, {
    getAvatarDescriptor: (type: string, id: string) => type === "group"
      ? { type, id, name: "群聊", avatarUrl: "", members }
      : members.find((member) => member.id === id),
    hydrateAvatarDescriptor: (value: AvatarDescriptor) => value,
  } as never, {} as never, { type: "user", id: "me", name: "我", avatarUrl: "" }, (changed) => {
    changes.push(changed)
    for (const listener of listeners) listener(changed)
  })
  return {
    manager, failing, changes, listeners,
    downloads: () => downloads,
    setAvatar: (id: string, avatarUrl: string) => {
      members = members.map((member) => member.id === id ? { ...member, avatarUrl } : member)
    },
    images: async (result: AvatarResult) => {
      assert.equal(result.status, "ready")
      const resource = await manager.readResource(new URL(result.resourceUrl!).pathname.slice(1))
      return (Buffer.from(resource.bytes).toString().match(/<image /g) ?? []).length
    },
    cleanup: async () => {
      manager.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

const groupRequest = { type: "group", id: "g1", theme: "light" } as const
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

test("资料补全重建群拼图后通知列表与header同步，缓存命中不重复广播", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  fixture.setAvatar("u2", "")
  let sidebar = await fixture.manager.getAvatar(groupRequest)
  const oldUrl = sidebar.resourceUrl
  assert.equal(await fixture.images(sidebar), 8)
  const pending: Promise<void>[] = []
  fixture.listeners.add((changes) => {
    if (changes.some((change) => change.type === "group" && change.id === "g1")) {
      pending.push(fixture.manager.getAvatar(groupRequest).then((result) => { sidebar = result }))
    }
  })
  fixture.setAvatar("u2", "/u2.png")
  const header = await fixture.manager.getAvatar(groupRequest)
  await Promise.all(pending)
  assert.equal(await fixture.images(header), 9)
  assert.notEqual(header.resourceUrl, oldUrl)
  assert.deepEqual(sidebar, header)
  const notifications = fixture.changes.length
  const downloads = fixture.downloads()
  assert.deepEqual(await fixture.manager.getAvatar(groupRequest), header)
  assert.equal(fixture.changes.length, notifications)
  assert.equal(fixture.downloads(), downloads)
})

test("成员图片恢复主动失效并通知相关群的亮暗拼图，不重复下载已有头像", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  fixture.failing.add("/u2.png")
  const darkRequest = { ...groupRequest, theme: "dark" } as const
  const light = await fixture.manager.getAvatar(groupRequest)
  const dark = await fixture.manager.getAvatar(darkRequest)
  assert.equal(await fixture.images(light), 8)
  assert.equal(await fixture.images(dark), 8)
  fixture.changes.length = 0
  fixture.failing.clear()
  await fixture.manager.getAvatar({ type: "user", id: "u2", theme: "light" })
  assert.ok(fixture.changes.flat().some((change) => change.type === "group" && change.id === "g1"))
  const downloads = fixture.downloads()
  const nextLight = await fixture.manager.getAvatar(groupRequest)
  const nextDark = await fixture.manager.getAvatar(darkRequest)
  assert.notEqual(nextLight.resourceUrl, light.resourceUrl)
  assert.notEqual(nextDark.resourceUrl, dark.resourceUrl)
  assert.equal(await fixture.images(nextLight), 9)
  assert.equal(await fixture.images(nextDark), 9)
  assert.equal(fixture.downloads(), downloads)
})

test("临时下载失败的群拼图30秒后重试，两个显示位置合并请求，恢复后停止重试", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  fixture.failing.add("/u2.png")
  const partial = await fixture.manager.getAvatar(groupRequest)
  assert.equal(await fixture.images(partial), 8)
  const downloads = fixture.downloads()
  fixture.changes.length = 0
  assert.deepEqual(await fixture.manager.getAvatar(groupRequest), partial)
  assert.equal(fixture.downloads(), downloads)
  t.mock.timers.tick(29_999)
  assert.equal(fixture.changes.length, 0)
  fixture.failing.clear()
  t.mock.timers.tick(1)
  assert.ok(fixture.changes.flat().some((change) => change.type === "group" && change.id === "g1"))
  const [sidebar, header] = await Promise.all([
    fixture.manager.getAvatar(groupRequest), fixture.manager.getAvatar(groupRequest),
  ])
  assert.equal(await fixture.images(sidebar), 9)
  assert.deepEqual(sidebar, header)
  assert.equal(fixture.downloads(), downloads + 1)
  fixture.changes.length = 0
  t.mock.timers.tick(60_000)
  assert.equal(fixture.changes.length, 0)
})

test("持续下载失败每30秒只重试缺失头像一次，不因刷新通知形成请求循环", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  fixture.failing.add("/u2.png")
  const partial = await fixture.manager.getAvatar(groupRequest)
  const downloads = fixture.downloads()
  const pending: Promise<AvatarResult>[] = []
  fixture.listeners.add((changes) => {
    if (changes.some((change) => change.type === "group" && change.id === "g1")) {
      pending.push(fixture.manager.getAvatar(groupRequest), fixture.manager.getAvatar(groupRequest))
    }
  })
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fixture.changes.length = 0
    t.mock.timers.tick(30_000)
    const results = await Promise.all(pending.splice(0))
    assert.equal(results.length, 2)
    for (const result of results) assert.deepEqual(result, partial)
    assert.equal(fixture.changes.length, 1)
    assert.equal(fixture.downloads(), downloads + attempt)
  }
})

test("成员本来没有头像不触发定时重试或额外网络请求", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  fixture.setAvatar("u2", "")
  const initial = await fixture.manager.getAvatar(groupRequest)
  assert.equal(await fixture.images(initial), 8)
  fixture.changes.length = 0
  t.mock.timers.tick(60_000)
  assert.equal(fixture.changes.length, 0)
  assert.deepEqual(await fixture.manager.getAvatar(groupRequest), initial)
  assert.equal(fixture.downloads(), 8)
})

test("关闭头像管理器后取消不完整拼图的定时重试", async (t) => {
  const fixture = await setupGroup()
  t.after(fixture.cleanup)
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  fixture.failing.add("/u2.png")
  await fixture.manager.getAvatar(groupRequest)
  fixture.manager.close()
  fixture.changes.length = 0
  t.mock.timers.tick(60_000)
  assert.equal(fixture.changes.length, 0)
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
