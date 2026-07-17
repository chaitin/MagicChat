import AsyncStorage from "@react-native-async-storage/async-storage"
import { Directory, File, Paths } from "expo-file-system"
import { Platform } from "react-native"

import type { ServerTarget } from "@/data/query"
import type { ResolvedResource } from "@/data/resources/resource-types"

const CACHE_INDEX_KEY = "@magicchat/resource-cache/v1"
const CACHE_ROOT_NAME = "magicchat-resources-v1"
const MAX_CACHE_SIZE_BYTES = 512 * 1024 * 1024

type CacheEntry = {
  fileName: string
  identity: string
  lastAccessedAt: number
  serverKey: string
  sizeBytes: number
}

type CacheIndex = {
  entries: Record<string, CacheEntry>
  version: 1
}

export type ResourceCacheTarget = {
  cacheId: string
  finalFile: File
  identity: string
  serverKey: string
  temporaryFile: File
}

let cacheRoot: Directory | null = null
let cacheIndexPromise: Promise<CacheIndex> | null = null
let cachePreparationPromise: Promise<void> | null = null
let mutationQueue: Promise<void> = Promise.resolve()

export async function getCachedResource(
  server: ServerTarget,
  identity: string
): Promise<ResolvedResource | null> {
  if (Platform.OS === "web") return null

  await prepareResourceCache()
  const root = getCacheRoot()
  const serverKey = createServerKey(server)
  const cacheId = createCacheId(serverKey, identity)
  const index = await loadCacheIndex()
  const entry = index.entries[cacheId]

  if (!entry || entry.identity !== identity || entry.serverKey !== serverKey) {
    return null
  }

  const file = new File(root, serverKey, "files", entry.fileName)
  if (!file.exists || file.size !== entry.sizeBytes) {
    await removeCacheEntry(cacheId, file)
    return null
  }

  entry.lastAccessedAt = Date.now()
  void queueIndexWrite(index)
  return createResolvedResource(identity, file, entry.sizeBytes, "cache")
}

export async function createResourceCacheTarget(
  server: ServerTarget,
  identity: string,
  extension: string
): Promise<ResourceCacheTarget> {
  await prepareResourceCache()
  const root = getCacheRoot()
  const serverKey = createServerKey(server)
  const filesDirectory = new Directory(root, serverKey, "files")
  const temporaryDirectory = new Directory(root, serverKey, "temp")
  filesDirectory.create({ idempotent: true, intermediates: true })
  temporaryDirectory.create({ idempotent: true, intermediates: true })
  const resourceKey = hashString(identity)
  const fileName = `${resourceKey}${extension}`

  return {
    cacheId: createCacheId(serverKey, identity),
    finalFile: new File(filesDirectory, fileName),
    identity,
    serverKey,
    temporaryFile: new File(
      temporaryDirectory,
      `${resourceKey}.${createOperationId()}.part`
    ),
  }
}

export async function commitResourceCacheTarget(
  target: ResourceCacheTarget,
  sizeBytes: number
) {
  if (target.finalFile.exists) target.finalFile.delete()
  await target.temporaryFile.move(target.finalFile, { overwrite: true })

  const entry: CacheEntry = {
    fileName: target.finalFile.name,
    identity: target.identity,
    lastAccessedAt: Date.now(),
    serverKey: target.serverKey,
    sizeBytes,
  }

  await mutateCacheIndex(async (index) => {
    index.entries[target.cacheId] = entry
    await persistCacheIndex(index)
  })
  await pruneResourceCache()

  return createResolvedResource(
    target.identity,
    target.finalFile,
    sizeBytes,
    "network"
  )
}

export async function removeServerResourceCache(server: ServerTarget) {
  if (Platform.OS === "web") return

  await prepareResourceCache()
  const root = getCacheRoot()
  const serverKey = createServerKey(server)
  const serverDirectory = new Directory(root, serverKey)

  try {
    if (serverDirectory.exists) serverDirectory.delete()
  } catch {
    // The metadata is still removed so stale files can never be returned.
  }

  await mutateCacheIndex(async (index) => {
    for (const [cacheId, entry] of Object.entries(index.entries)) {
      if (entry.serverKey === serverKey) delete index.entries[cacheId]
    }
    await persistCacheIndex(index)
  })
}

export async function removeCachedResource(
  server: ServerTarget,
  identity: string
) {
  if (Platform.OS === "web") return

  await prepareResourceCache()
  const root = getCacheRoot()
  const serverKey = createServerKey(server)
  const cacheId = createCacheId(serverKey, identity)
  const index = await loadCacheIndex()
  const entry = index.entries[cacheId]
  if (!entry || entry.identity !== identity) return

  const file = new File(root, serverKey, "files", entry.fileName)
  await removeCacheEntry(cacheId, file)
}

async function pruneResourceCache() {
  await mutateCacheIndex(async (index) => {
    const root = getCacheRoot()
    const entries = Object.entries(index.entries)
    let totalSizeBytes = entries.reduce(
      (total, [, entry]) => total + entry.sizeBytes,
      0
    )
    if (totalSizeBytes <= MAX_CACHE_SIZE_BYTES) return

    const oldestFirst = entries.sort(
      (left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt
    )

    for (const [cacheId, entry] of oldestFirst) {
      if (totalSizeBytes <= MAX_CACHE_SIZE_BYTES) break
      const file = new File(root, entry.serverKey, "files", entry.fileName)
      try {
        if (file.exists) file.delete()
      } catch {
        // Removing the index entry is enough to prevent another cache hit.
      }
      delete index.entries[cacheId]
      totalSizeBytes -= entry.sizeBytes
    }

    await persistCacheIndex(index)
  })
}

async function removeCacheEntry(cacheId: string, file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // Continue removing metadata even when the file system rejects deletion.
  }

  await mutateCacheIndex(async (index) => {
    delete index.entries[cacheId]
    await persistCacheIndex(index)
  })
}

async function prepareResourceCache() {
  if (Platform.OS === "web") return
  if (cachePreparationPromise) return cachePreparationPromise

  cachePreparationPromise = Promise.resolve().then(() => {
    const root = getCacheRoot()
    root.create({ idempotent: true, intermediates: true })

    for (const child of root.list()) {
      if (!(child instanceof Directory)) continue
      const temporaryDirectory = new Directory(child, "temp")
      if (!temporaryDirectory.exists) continue

      for (const temporaryFile of temporaryDirectory.list()) {
        if (temporaryFile instanceof File && temporaryFile.name.endsWith(".part")) {
          try {
            temporaryFile.delete()
          } catch {
            // A later startup can retry stale temporary-file cleanup.
          }
        }
      }
    }
  })

  return cachePreparationPromise
}

function loadCacheIndex() {
  if (!cacheIndexPromise) {
    cacheIndexPromise = AsyncStorage.getItem(CACHE_INDEX_KEY)
      .then(parseCacheIndex)
      .catch(() => createEmptyCacheIndex())
  }
  return cacheIndexPromise
}

function mutateCacheIndex(operation: (index: CacheIndex) => Promise<void>) {
  const result = mutationQueue
    .catch(() => undefined)
    .then(async () => operation(await loadCacheIndex()))
  mutationQueue = result.catch(() => undefined)
  return result
}

function queueIndexWrite(index: CacheIndex) {
  return mutateCacheIndex(() => persistCacheIndex(index))
}

async function persistCacheIndex(index: CacheIndex) {
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index))
}

function parseCacheIndex(value: string | null): CacheIndex {
  if (!value) return createEmptyCacheIndex()

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
      return createEmptyCacheIndex()
    }

    const entries: Record<string, CacheEntry> = {}
    for (const [cacheId, candidate] of Object.entries(parsed.entries)) {
      if (isCacheEntry(candidate)) entries[cacheId] = candidate
    }
    return { entries, version: 1 }
  } catch {
    return createEmptyCacheIndex()
  }
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    typeof value.fileName === "string" &&
    typeof value.identity === "string" &&
    typeof value.lastAccessedAt === "number" &&
    typeof value.serverKey === "string" &&
    typeof value.sizeBytes === "number" &&
    value.sizeBytes > 0
  )
}

function createEmptyCacheIndex(): CacheIndex {
  return { entries: {}, version: 1 }
}

function getCacheRoot() {
  if (!cacheRoot) cacheRoot = new Directory(Paths.cache, CACHE_ROOT_NAME)
  return cacheRoot
}

function createResolvedResource(
  identity: string,
  file: File,
  sizeBytes: number,
  source: ResolvedResource["source"]
): ResolvedResource {
  return {
    identity,
    sizeBytes,
    source,
    uri: file.uri,
  }
}

function createServerKey(server: ServerTarget) {
  return hashString(`${server.id}\n${server.url.replace(/\/+$/, "")}`)
}

function createCacheId(serverKey: string, identity: string) {
  return `${serverKey}:${hashString(identity)}`
}

function hashString(value: string) {
  return `${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x9e3779b9)}`
}

function fnv1a(value: string, seed: number) {
  let hash = seed
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function createOperationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
