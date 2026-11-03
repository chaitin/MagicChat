import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { SharedTaskPool } from "@/data/resources/shared-task-pool"
import { getAttachmentCacheExtension, hasExpectedVoiceCacheExtension } from "@/data/resources/resource-file-extension"

function loadModule(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}, suffix = "") {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(code + suffix, {
    ...globals,
    exports,
    require(name: string) {
      if (!(name in modules)) throw new Error(`unexpected import ${name}`)
      return modules[name]
    },
  })
  return exports
}

function harness(platform = "android") {
  const cache = new Map<string, any>()
  const files: any[] = []
  let nativeCalls = 0
  let urlCalls = 0
  let commits = 0
  let webFetchCalls = 0
  const revokedURLs: string[] = []
  const createdURLs: string[] = []
  const webURL = {
    createObjectURL() {
      const uri = `blob:video-${createdURLs.length + 1}`
      createdURLs.push(uri)
      return uri
    },
    revokeObjectURL(uri: string) { revokedURLs.push(uri) },
  }
  let nativeDownload = async (_url: string, file: any, options: any) => {
    options.onProgress({ bytesWritten: 512, totalBytes: 1024 })
    file.exists = true
    file.size = 1024
    return file
  }
  let readUrl = async (_session: any, ids: string[], _options: any) =>
    ids.map((fileId) => ({ fileId, url: "https://media.example.test/video", sizeBytes: 1024 }))
  const downloader = loadModule("../src/data/resources/resource-downloader.ts", {
    "expo-file-system": {
      File: {
        downloadFileAsync: (...args: Parameters<typeof nativeDownload>) => {
          nativeCalls++
          return nativeDownload(...args)
        },
      },
    },
  }, {
    Blob, URL: webURL,
    fetch: async () => {
      webFetchCalls++
      return new Response(new Uint8Array(1024), { headers: { "Content-Length": "1024" } })
    },
  })
  const key = (server: any, identity: string) => JSON.stringify([server.id, server.url, identity])
  const repository = loadModule("../src/data/resources/resource-repository.ts", {
    "react-native": { Platform: { OS: platform } },
    "@/data/resources/attachment-resource-memory": {
      clearAttachmentResourceMemory() {},
      forgetAttachmentResource() {},
      forgetServerAttachmentResources() {},
      getRememberedAttachmentResource() { return null },
      rememberAttachmentResource() { throw new Error("video must not use server-only memory cache") },
    },
    "@/data/resources/resource-cache-store": {
      MAX_CACHE_SIZE_BYTES: 512 * 1024 * 1024,
      getCachedResource: async (server: any, identity: string) => cache.get(key(server, identity)) ?? null,
      createResourceCacheTarget: async (server: any, identity: string, extension: string) => {
        const temporaryFile = { exists: false, size: 0, delete() { this.exists = false } }
        files.push(temporaryFile)
        return { server, identity, extension, temporaryFile }
      },
      commitResourceCacheTarget: async (target: any, sizeBytes: number) => {
        commits++
        target.temporaryFile.exists = false
        const resource = { identity: target.identity, sizeBytes, uri: `file:///cache/${commits}${target.extension}`, source: "cache" }
        cache.set(key(target.server, target.identity), resource)
        return resource
      },
      clearResourceCache: async () => { cache.clear() },
      getResourceCacheSize: async () => 0,
      removeCachedResource: async (server: any, identity: string) => { cache.delete(key(server, identity)) },
      removeServerResourceCache: async () => { cache.clear() },
    },
    "@/data/resources/resource-downloader": downloader,
    "@/data/resources/resource-file-extension": { getAttachmentCacheExtension, hasExpectedVoiceCacheExtension },
    "@/data/resources/resource-request-pool": { requestResourceReadUrl() { throw new Error("video URL must use the cancellable API") } },
    "@/data/resources/resource-read-url-api": {
      fetchResourceReadUrls: (...args: Parameters<typeof readUrl>) => { urlCalls++; return readUrl(...args) },
    },
    "@/data/resources/shared-task-pool": { SharedTaskPool },
    "@/lib/server-asset-url": { resolveServerAssetUrl() { return "" } },
  }, { URL: webURL })
  return {
    repository, files, cache, revokedURLs, createdURLs,
    webFetches: () => webFetchCalls,
    native: (fn: typeof nativeDownload) => { nativeDownload = fn },
    readUrl: (fn: typeof readUrl) => { readUrl = fn },
    counts: () => ({ nativeCalls, urlCalls, commits }),
  }
}

const session = { id: "server-1", url: "https://server.example.test", userId: "user-1" }
const video = { fileId: "video-1", fileName: "clip.mp4", expectedSizeBytes: 1024, kind: "video", mimeType: "video/mp4", type: "attachment" }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const require = createRequire(import.meta.url)
const { AbortController: NativeAbortController } = createRequire(require.resolve("react-native/package.json"))("abort-controller/dist/abort-controller")

test("React Native AbortSignal缺少throwIfAborted时仍完整下载并复用缓存", async () => {
  const h = harness()
  const controller = new NativeAbortController()
  assert.equal(typeof controller.signal.throwIfAborted, "undefined")
  const options = { signal: controller.signal }
  const first = await h.repository.ensureAttachmentResource(session, video, options)
  assert.match(first.uri, /^file:\/\//)
  assert.equal((await h.repository.ensureAttachmentResource(session, video, options)).uri, first.uri)
  assert.deepEqual(h.counts(), { nativeCalls: 1, urlCalls: 1, commits: 1 })
})

test("React Native AbortSignal预先取消时拒绝下载且不发请求", async () => {
  const h = harness()
  const controller = new NativeAbortController()
  controller.abort()
  await assert.rejects(h.repository.ensureAttachmentResource(session, video, {
    signal: controller.signal,
  }), (error: any) => error?.name === "AbortError")
  assert.deepEqual(h.counts(), { nativeCalls: 0, urlCalls: 0, commits: 0 })
})

test("React Native AbortSignal在进度回调取消时删除半成品且不提交缓存", async () => {
  const h = harness()
  const controller = new NativeAbortController()
  await assert.rejects(h.repository.ensureAttachmentResource(session, video, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  }), (error: any) => error?.name === "AbortError")
  assert.equal(h.counts().nativeCalls, 1)
  assert.equal(h.counts().commits, 0)
  assert.equal(h.files[0].exists, false)
})

test("视频完整下载后返回本地URI，再次打开复用缓存且不请求地址", async () => {
  const h = harness()
  const progress: any[] = []
  let starts = 0
  const resource = await h.repository.ensureAttachmentResource(session, video, {
    onDownloadStart: () => starts++,
    onProgress: (value: any) => progress.push(value),
  })
  assert.match(resource.uri, /^file:\/\//)
  assert.equal(resource.mimeType, "video/mp4")
  assert.equal(starts, 1)
  assert.equal(progress[0].bytesWritten, 512)
  assert.equal(progress[0].totalBytes, 1024)
  assert.equal(progress.at(-1).bytesWritten, 1024)
  assert.equal((await h.repository.ensureAttachmentResource(session, video)).uri, resource.uri)
  assert.deepEqual(h.counts(), { nativeCalls: 1, urlCalls: 1, commits: 1 })
})

test("关闭预览真正取消原生下载、删除临时文件，并允许重新进入", async () => {
  const h = harness()
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  h.native(async (_url, file, options) => {
    file.exists = true
    started()
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
    })
  })
  const pending = h.repository.ensureAttachmentResource(session, video, { signal: controller.signal })
  await ready
  controller.abort()
  await assert.rejects(pending, (error: any) => error.name === "AbortError")
  assert.equal(h.files[0].exists, false)
  assert.equal(h.counts().commits, 0)

  h.native(async (_url, file) => { file.exists = true; file.size = 1024; return file })
  assert.match((await h.repository.ensureAttachmentResource(session, video)).uri, /^file:\/\//)
  assert.equal(h.counts().nativeCalls, 2)
})

test("获取视频地址时也透传取消信号，取消后不启动文件下载", async () => {
  const h = harness()
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  h.readUrl(async (_target, _ids, options) => {
    assert.equal(options.signal, controller.signal)
    started()
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
    })
  })
  const pending = h.repository.ensureAttachmentResource(session, video, { signal: controller.signal })
  await ready
  controller.abort()
  await assert.rejects(pending, (error: any) => error.name === "AbortError")
  assert.equal(h.counts().nativeCalls, 0)
})

test("进度回调触发取消后不提交缓存，完整性检查失败也清理半成品", async () => {
  const h = harness()
  const controller = new AbortController()
  await assert.rejects(h.repository.ensureAttachmentResource(session, video, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  }), (error: any) => error.name === "AbortError")
  assert.equal(h.counts().commits, 0)
  assert.equal(h.files[0].exists, false)

  h.native(async (_url, file) => { file.exists = true; file.size = 512; return file })
  await assert.rejects(h.repository.ensureAttachmentResource(session, video), /资源不完整/)
  assert.equal(h.files[1].exists, false)
  assert.equal(h.counts().commits, 0)
})

test("未知总大小时只上报已下载字节，不伪造百分比", async () => {
  const h = harness()
  h.readUrl(async (_target, ids) => ids.map((fileId) => ({ fileId, url: "https://media.example.test/video", sizeBytes: null as any })))
  h.native(async (_url, file, options) => {
    options.onProgress({ bytesWritten: 100, totalBytes: -1 })
    file.exists = true
    file.size = 200
    return file
  })
  const progress: any[] = []
  await h.repository.ensureAttachmentResource(session, { ...video, expectedSizeBytes: undefined }, {
    onProgress: (value: any) => progress.push(value),
  })
  assert.equal(progress[0].bytesWritten, 100)
  assert.equal(progress[0].totalBytes, undefined)
  assert.equal(progress.at(-1).bytesWritten, 200)
})

test("相同服务器和fileId的视频缓存按账号隔离", async () => {
  const h = harness()
  const first = await h.repository.ensureAttachmentResource(session, video)
  const second = await h.repository.ensureAttachmentResource({ ...session, userId: "user-2" }, video)
  assert.notEqual(first.uri, second.uri)
  assert.equal(h.cache.size, 2)
  await h.repository.invalidateAttachmentResource(session, video)
  assert.equal(h.cache.size, 1)
  assert.equal(h.counts().nativeCalls, 2)
})

test("清缓存等待取消中的下载完成，取消任务不会重新写入已清理缓存", async () => {
  const h = harness()
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  h.native(async (_url, file, options) => {
    file.exists = true
    started()
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }))
  })
  const pending = h.repository.ensureAttachmentResource(session, video, { signal: controller.signal })
  await ready
  let cleared = false
  const clear = h.repository.clearResourceCache().then(() => { cleared = true })
  await flush()
  assert.equal(cleared, false)
  controller.abort()
  await assert.rejects(pending)
  await clear
  assert.equal(cleared, true)
  assert.equal(h.cache.size, 0)
  assert.equal(h.files[0].exists, false)
})

test("网页视频也先完整下载为Blob，重复打开命中内存缓存，清理时释放地址", async () => {
  const h = harness("web")
  const progress: any[] = []
  const first = await h.repository.ensureAttachmentResource(session, video, {
    onProgress: (value: any) => progress.push(value),
  })
  assert.match(first.uri, /^blob:/)
  assert.equal(first.sizeBytes, 1024)
  assert.equal(progress.at(-1).bytesWritten, 1024)
  assert.equal((await h.repository.ensureAttachmentResource(session, video)).uri, first.uri)
  assert.equal(h.webFetches(), 1)
  assert.equal(h.counts().nativeCalls, 0)
  assert.equal(h.counts().urlCalls, 1)
  assert.equal(await h.repository.getResourceCacheSize(), 1024)
  await h.repository.clearResourceCache()
  assert.deepEqual(h.revokedURLs, [first.uri])
  assert.equal(await h.repository.getResourceCacheSize(), 0)
  await h.repository.ensureAttachmentResource(session, video)
  assert.equal(h.webFetches(), 2)
})

test("网页下载取消后不生成Blob地址，也不留下完整缓存", async () => {
  const h = harness("web")
  const controller = new AbortController()
  await assert.rejects(h.repository.ensureAttachmentResource(session, video, {
    signal: controller.signal,
    onProgress: () => controller.abort(),
  }), (error: any) => error.name === "AbortError")
  assert.equal(h.createdURLs.length, 0)
  assert.equal(await h.repository.getResourceCacheSize(), 0)
})

test("刚下载的超大视频不被缓存上限立即淘汰，旧文件仍会回收", async () => {
  const deleted: string[] = []
  let saved: any
  const entry = (name: string, size: number, time: number) => ({
    fileName: name, identity: name, lastAccessedAt: time, serverKey: "server", sizeBytes: size,
  })
  const index = { version: 1, entries: {
    current: entry("large.mp4", 600 * 1024 * 1024, 2),
    old: entry("old.webp", 20 * 1024 * 1024, 1),
  } }
  const store = loadModule("../src/data/resources/resource-cache-store.ts", {
    "@react-native-async-storage/async-storage": {
      getItem: async () => JSON.stringify(index),
      setItem: async (_key: string, value: string) => { saved = JSON.parse(value) },
    },
    "expo-file-system": {
      Directory: class {},
      Paths: { cache: "cache" },
      File: class {
        exists = true
        name: string
        constructor(...parts: any[]) { this.name = parts.at(-1) }
        delete() { deleted.push(this.name) }
      },
    },
    "react-native": { Platform: { OS: "android" } },
  }, {}, "\nexports.pruneForTest = pruneResourceCache;")
  await store.pruneForTest("current")
  assert.deepEqual(deleted, ["old.webp"])
  assert.deepEqual(Object.keys(saved.entries), ["current"])
})

test("已经取消的预览不读取缓存、不请求地址、不开始下载", async () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(h.repository.ensureAttachmentResource(session, video, { signal: controller.signal }))
  assert.deepEqual(h.counts(), { nativeCalls: 0, urlCalls: 0, commits: 0 })
})
