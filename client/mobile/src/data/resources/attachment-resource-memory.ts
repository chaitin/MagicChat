import type { ResolvedResource } from "@/core/resource-models"
import type { ServerTarget } from "@/core/server-target"

const MAX_RESOURCE_ENTRIES = 1024
const MAX_LOADED_IMAGE_ENTRIES = 512

const resources = new Map<string, ResolvedResource>()
const loadedImages = new Map<string, true>()

export function getRememberedAttachmentResource(
  server: ServerTarget,
  fileId: string
) {
  return touch(resources, createResourceKey(server, fileId))
}

export function rememberAttachmentResource(
  server: ServerTarget,
  fileId: string,
  resource: ResolvedResource
) {
  setLru(
    resources,
    createResourceKey(server, fileId),
    resource,
    MAX_RESOURCE_ENTRIES
  )
}

export function forgetAttachmentResource(
  server: ServerTarget,
  fileId: string
) {
  const key = createResourceKey(server, fileId)
  const resource = resources.get(key)
  if (resource) loadedImages.delete(resource.uri)
  resources.delete(key)
}

export function forgetServerAttachmentResources(server: ServerTarget) {
  const prefix = createServerPrefix(server)
  for (const [key, resource] of resources) {
    if (!key.startsWith(prefix)) continue
    loadedImages.delete(resource.uri)
    resources.delete(key)
  }
}

export function clearAttachmentResourceMemory() {
  resources.clear()
  loadedImages.clear()
}

export function hasLoadedAttachmentImage(uri: string) {
  return touch(loadedImages, uri) === true
}

export function markAttachmentImageLoaded(uri: string) {
  setLru(loadedImages, uri, true, MAX_LOADED_IMAGE_ENTRIES)
}

export function forgetLoadedAttachmentImage(uri: string) {
  loadedImages.delete(uri)
}

function createResourceKey(server: ServerTarget, fileId: string) {
  return `${createServerPrefix(server)}${fileId}`
}

function createServerPrefix(server: ServerTarget) {
  return `${server.id}\n${server.url}\n`
}

function touch<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function setLru<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number
) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}
