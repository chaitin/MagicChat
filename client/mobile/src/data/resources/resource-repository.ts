import { Platform } from "react-native"

import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import {
  clearAttachmentResourceMemory,
  forgetAttachmentResource,
  forgetServerAttachmentResources,
  getRememberedAttachmentResource,
  rememberAttachmentResource,
} from "@/data/resources/attachment-resource-memory"
import {
  clearResourceCache as clearResourceCacheStore,
  commitResourceCacheTarget,
  createResourceCacheTarget,
  getResourceCacheSize as getResourceCacheSizeStore,
  getCachedResource,
  removeCachedResource,
  removeServerResourceCache as removeServerResourceCacheStore,
} from "@/data/resources/resource-cache-store"
import { downloadResource } from "@/data/resources/resource-downloader"
import {
  getAttachmentCacheExtension,
  hasExpectedVoiceCacheExtension,
} from "@/data/resources/resource-file-extension"
import { requestResourceReadUrl } from "@/data/resources/resource-request-pool"
import type {
  AttachmentResourceReference,
  AvatarResourceReference,
  ResolvedResource,
} from "@/core/resource-models"
import { SharedTaskPool } from "@/data/resources/shared-task-pool"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

const downloadTasks = new SharedTaskPool<ResolvedResource>()

export async function getCachedAttachmentResource(
  server: ServerTarget,
  reference: AttachmentResourceReference
) {
  if (Platform.OS !== "web") {
    const remembered = getRememberedAttachmentResource(
      server,
      reference.fileId
    )
    if (remembered) return withMimeType(remembered, reference.mimeType)
  }

  const identity = getAttachmentIdentity(reference.fileId)
  const resource = await getCachedResource(server, identity)
  if (!resource) return null
  if (!hasExpectedVoiceCacheExtension(reference, resource.uri)) {
    await removeCachedResource(server, identity)
    return null
  }
  const resolved = withMimeType(resource, reference.mimeType)
  if (Platform.OS !== "web") {
    rememberAttachmentResource(server, reference.fileId, resolved)
  }
  return resolved
}

export async function ensureAttachmentResource(
  session: AuthenticatedTarget,
  reference: AttachmentResourceReference,
  options: { signal?: AbortSignal } = {}
) {
  const identity = getAttachmentIdentity(reference.fileId)
  if (reference.kind === "video") {
    const readUrl = await requestResourceReadUrl(session, reference.fileId)
    return createRemoteResource(
      identity,
      readUrl.url,
      readUrl.sizeBytes ?? reference.expectedSizeBytes ?? 0,
      reference.mimeType
    )
  }
  const cached = await getCachedAttachmentResource(session, reference)
  if (cached) return cached

  const resource = await runDownloadOnce(
    session,
    identity,
    async () => {
      const rechecked = await getCachedAttachmentResource(session, reference)
      if (rechecked) return rechecked

      const readUrl = await requestResourceReadUrl(session, reference.fileId)
      if (Platform.OS === "web") {
        return createRemoteResource(
          identity,
          readUrl.url,
          readUrl.sizeBytes ?? reference.expectedSizeBytes ?? 0,
          reference.mimeType
        )
      }

      return downloadToCache({
        expectedSizeBytes: readUrl.sizeBytes ?? reference.expectedSizeBytes,
        extension: getAttachmentCacheExtension(reference, readUrl.url),
        identity,
        server: session,
        sourceUrl: readUrl.url,
      })
    },
    options.signal
  )

  const resolved = withMimeType(resource, reference.mimeType)
  if (Platform.OS !== "web") {
    rememberAttachmentResource(session, reference.fileId, resolved)
  }
  return resolved
}

export function invalidateAttachmentResource(
  server: ServerTarget,
  reference: AttachmentResourceReference
) {
  forgetAttachmentResource(server, reference.fileId)
  return removeCachedResource(server, getAttachmentIdentity(reference.fileId))
}

export function resolveAvatarResourceUrl(
  server: ServerTarget,
  avatar: string
) {
  const resolved = resolveServerAssetUrl(server.url, avatar).trim()
  if (!resolved) return ""

  try {
    const url = new URL(resolved)
    url.hash = ""
    return url.toString()
  } catch {
    return resolved
  }
}

export async function ensureAvatarResource(
  server: ServerTarget,
  reference: AvatarResourceReference,
  options: { signal?: AbortSignal } = {}
): Promise<ResolvedResource | null> {
  const sourceUrl = resolveAvatarResourceUrl(server, reference.url)
  if (!sourceUrl) return null
  const identity = getAvatarIdentity(sourceUrl)
  const cached = await getCachedResource(server, identity)
  if (cached) return cached

  if (Platform.OS === "web") {
    return createRemoteResource(identity, sourceUrl, 0)
  }

  return runDownloadOnce(
    server,
    identity,
    async () => {
      const rechecked = await getCachedResource(server, identity)
      if (rechecked) return rechecked

      return downloadToCache({
        extension: getUrlExtension(sourceUrl, ".image"),
        identity,
        server,
        sourceUrl,
      })
    },
    options.signal
  )
}

export function invalidateAvatarResource(
  server: ServerTarget,
  avatar: string
) {
  const sourceUrl = resolveAvatarResourceUrl(server, avatar)
  if (!sourceUrl) return Promise.resolve()
  return removeCachedResource(server, getAvatarIdentity(sourceUrl))
}

export async function ensureImageUrlResource(
  server: ServerTarget,
  sourceUrl: string,
  options: { signal?: AbortSignal } = {}
) {
  const normalizedUrl = normalizeImageUrl(sourceUrl)
  const identity = getImageUrlIdentity(normalizedUrl)
  const cached = await getCachedResource(server, identity)
  if (cached) return cached

  if (Platform.OS === "web") {
    return createRemoteResource(identity, normalizedUrl, 0)
  }

  return runDownloadOnce(
    server,
    identity,
    async () => {
      const rechecked = await getCachedResource(server, identity)
      if (rechecked) return rechecked

      return downloadToCache({
        extension: getUrlExtension(normalizedUrl, ".image"),
        identity,
        server,
        sourceUrl: normalizedUrl,
      })
    },
    options.signal
  )
}

export function invalidateImageUrlResource(
  server: ServerTarget,
  sourceUrl: string
) {
  try {
    return removeCachedResource(
      server,
      getImageUrlIdentity(normalizeImageUrl(sourceUrl))
    )
  } catch {
    return Promise.resolve()
  }
}

export function getResourceCacheSize() {
  return getResourceCacheSizeStore()
}

export function clearResourceCache() {
  return downloadTasks.runExclusive(async () => {
    await clearResourceCacheStore()
    clearAttachmentResourceMemory()
  })
}

export async function removeServerResourceCache(server: ServerTarget) {
  const taskPrefix = createDownloadTaskPrefix(server)
  const activeTasks = downloadTasks.listByPrefix(taskPrefix)

  await Promise.allSettled(activeTasks)
  await removeServerResourceCacheStore(server)
  forgetServerAttachmentResources(server)
}

async function downloadToCache({
  expectedSizeBytes,
  extension,
  identity,
  server,
  sourceUrl,
}: {
  expectedSizeBytes?: number
  extension: string
  identity: string
  server: ServerTarget
  sourceUrl: string
}) {
  const target = await createResourceCacheTarget(server, identity, extension)
  const downloaded = await downloadResource({
    expectedSizeBytes,
    sourceUrl,
    temporaryFile: target.temporaryFile,
  })
  return commitResourceCacheTarget(target, downloaded.sizeBytes)
}

function runDownloadOnce(
  server: ServerTarget,
  identity: string,
  operation: () => Promise<ResolvedResource>,
  signal?: AbortSignal
) {
  const taskKey = `${createDownloadTaskPrefix(server)}${identity}`
  return downloadTasks.run(taskKey, operation, signal)
}

function createDownloadTaskPrefix(server: ServerTarget) {
  return `${server.id}\n${server.url}\n`
}

function createRemoteResource(
  identity: string,
  uri: string,
  sizeBytes: number,
  mimeType?: string
): ResolvedResource {
  return {
    identity,
    mimeType,
    sizeBytes,
    source: "network",
    uri,
  }
}

function withMimeType(resource: ResolvedResource, mimeType?: string) {
  return mimeType ? { ...resource, mimeType } : resource
}

function getAttachmentIdentity(fileId: string) {
  return `attachment:${fileId}`
}

function getAvatarIdentity(url: string) {
  return `avatar:${url}`
}

function getImageUrlIdentity(url: string) {
  return `image-url:${url}`
}

function normalizeImageUrl(value: string) {
  const url = new URL(value.trim())
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("图片地址无效")
  }
  url.hash = ""
  return url.toString()
}

function getUrlExtension(value: string, fallback: string) {
  try {
    return getPathExtension(new URL(value).pathname) || fallback
  } catch {
    return fallback
  }
}

function getPathExtension(value: string) {
  const match = /\.[a-zA-Z0-9]{1,10}$/.exec(value)
  return match ? match[0].toLowerCase() : ""
}
