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
        assert.equal(url, "https://chat.example.test/avatars/project-member.png")
        downloadCount += 1
        return { bytes, contentType: "image/png" }
      },
    } as never,
    {} as never,
    {
      getAvatarDescriptor: () => descriptor,
      refreshAvatarDescriptor: async (type: string, id: string) => {
        assert.equal(type, "user")
        assert.equal(id, "project-member")
        refreshCount += 1
        if (failRefresh) throw new Error("network unavailable")
        descriptor = {
          type: "user",
          id,
          name: "项目成员",
          avatarUrl: "/avatars/project-member.png",
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
    failRefresh: () => {
      failRefresh = true
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

const request = { type: "user", id: "project-member", theme: "light" } as const

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
