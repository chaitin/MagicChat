import { File } from "expo-file-system"
import { SvgXml } from "react-native-svg"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Platform, StyleSheet } from "react-native"

import {
  createGroupAvatarIdentity,
  GroupAvatarGenerationLimiter,
  GROUP_AVATAR_OUTPUT_SIZE,
  GroupAvatarGenerationEpoch,
  GroupAvatarMemoryCache,
  type GroupAvatarGenerationSnapshot,
  type GroupAvatarVisualTokens,
} from "@/components/avatar/group-avatar-cache"
import { getGroupAvatarGridSize, type AvatarMember } from "@/components/avatar/avatar-strategy"
import { buildGroupAvatarSvg, type CompositeAvatarTile } from "@/components/avatar/group-avatar-svg"
import type { ResolvedResource } from "@/core/resource-models"
import type { ServerTarget } from "@/core/server-target"
import {
  commitResourceCacheTarget,
  createResourceCacheTarget,
  getCachedResource,
  removeCachedResource,
  subscribeResourceCacheCleared,
} from "@/data/resources/resource-cache-store"

const memory = new GroupAvatarMemoryCache<ResolvedResource>()
const epochs = new GroupAvatarGenerationEpoch()
type GroupAvatarTask = {
  promise: Promise<ResolvedResource>
  snapshot: GroupAvatarGenerationSnapshot
}
const tasks = new Map<string, GroupAvatarTask>()
const generationLimiter = new GroupAvatarGenerationLimiter(2)
const GROUP_AVATAR_MAX_AGE_MS = 24 * 60 * 60 * 1_000
let generationQueue = Promise.resolve()
subscribeResourceCacheCleared((server) => {
  epochs.invalidate(server)
  if (server) memory.clearServer(server)
  else memory.clear()
})

class GroupAvatarOwnerUnmountedError extends Error {
  constructor() {
    super("Group avatar generation owner unmounted")
  }
}
class GroupAvatarGenerationInvalidatedError extends Error {
  constructor() {
    super("Group avatar generation invalidated")
  }
}

export function useGroupAvatarComposite({ entries, server, theme, tokens }: {
  entries: AvatarMember[]
  server: ServerTarget
  theme: "light" | "dark"
  tokens: GroupAvatarVisualTokens
}) {
  const gridSize = getGroupAvatarGridSize(entries.length)
  const identity = useMemo(() => createGroupAvatarIdentity({ entries, gridSize, server, theme, tokens }), [entries, gridSize, server, theme, tokens])
  const memoryKey = `${server.id}\n${server.url}\n${identity}`
  const [resourceState, setResourceState] = useState(() => ({
    memoryKey,
    resource: memory.get(memoryKey, GROUP_AVATAR_MAX_AGE_MS) ?? null,
  }))
  const resource = resourceState.memoryKey === memoryKey ? resourceState.resource : null
  const [generate, setGenerate] = useState(false)
  const [generationSnapshot, setGenerationSnapshot] = useState<GroupAvatarGenerationSnapshot | null>(null)
  const [attempt, setAttempt] = useState(0)
  const resolver = useRef<((resource: ResolvedResource) => void) | null>(null)
  const rejecter = useRef<((error: unknown) => void) | null>(null)
  const releaseGenerationRef = useRef<(() => void) | null>(null)
  const renderRetryRef = useRef({ memoryKey, count: 0 })
  const serverRef = useRef(server)
  useEffect(() => { serverRef.current = server }, [server])

  useEffect(() => {
    if (Platform.OS === "web") return
    const activeServer = serverRef.current
    let active = true
    const cached = memory.get(memoryKey, GROUP_AVATAR_MAX_AGE_MS)
    if (cached) {
      queueMicrotask(() => {
        if (active) setResourceState({ memoryKey, resource: cached })
      })
      return () => { active = false }
    }
    let taskRecord = tasks.get(memoryKey)
    let cancelScheduledGeneration: (() => void) | null = null
    let rejectOwnedTask: ((error: unknown) => void) | null = null
    if (!taskRecord) {
      const snapshot = epochs.capture(activeServer)
      const promise = new Promise<ResolvedResource>((resolve, reject) => {
        rejectOwnedTask = reject
        resolver.current = resolve
        rejecter.current = reject
        void getCachedResource(activeServer, identity, { maxAgeMs: GROUP_AVATAR_MAX_AGE_MS }).then((disk) => {
          if (!epochs.isCurrent(activeServer, snapshot)) {
            reject(new GroupAvatarGenerationInvalidatedError())
          } else if (disk) {
            resolve(disk)
          } else if (active) {
            cancelScheduledGeneration = generationLimiter.schedule((release) => {
              if (!active || !epochs.isCurrent(activeServer, snapshot)) {
                release()
                reject(new GroupAvatarGenerationInvalidatedError())
                return
              }
              releaseGenerationRef.current = release
              setGenerationSnapshot(snapshot)
              setGenerate(true)
            })
          } else {
            reject(new GroupAvatarOwnerUnmountedError())
          }
        }, reject)
      })
      taskRecord = { promise, snapshot }
      tasks.set(memoryKey, taskRecord)
    }
    const currentTask = taskRecord
    void currentTask.promise.then(
      (value) => {
        if (epochs.isCurrent(activeServer, currentTask.snapshot)) {
          memory.set(memoryKey, value)
          if (active) setResourceState({ memoryKey, resource: value })
        } else if (active) {
          setAttempt((current) => current + 1)
        }
        if (tasks.get(memoryKey) === currentTask) tasks.delete(memoryKey)
      },
      (error) => {
        if (tasks.get(memoryKey) === currentTask) tasks.delete(memoryKey)
        if (active && (error instanceof GroupAvatarOwnerUnmountedError || error instanceof GroupAvatarGenerationInvalidatedError)) {
          setAttempt((current) => current + 1)
        }
      },
    )
    return () => {
      active = false
      cancelScheduledGeneration?.()
      releaseGenerationRef.current = null
      rejectOwnedTask?.(new GroupAvatarOwnerUnmountedError())
    }
  }, [attempt, identity, memoryKey])

  const releaseGeneration = useCallback(() => {
    releaseGenerationRef.current?.()
    releaseGenerationRef.current = null
  }, [])
  const complete = useCallback((value: ResolvedResource) => {
    const activeServer = serverRef.current
    if (!generationSnapshot || !epochs.isCurrent(activeServer, generationSnapshot)) {
      rejecter.current?.(new GroupAvatarGenerationInvalidatedError())
      void removeCachedResource(activeServer, identity)
    } else {
      resolver.current?.(value)
    }
    releaseGeneration()
    setGenerate(false)
  }, [generationSnapshot, identity, releaseGeneration])
  const fail = useCallback((error: unknown) => {
    rejecter.current?.(error)
    releaseGeneration()
    setGenerate(false)
  }, [releaseGeneration])
  const invalidate = useCallback(() => {
    const activeServer = serverRef.current
    memory.delete(memoryKey)
    setResourceState({ memoryKey, resource: null })
    if (renderRetryRef.current.memoryKey !== memoryKey) {
      renderRetryRef.current = { memoryKey, count: 0 }
    }
    const retry = renderRetryRef.current.count++ < 1
    void removeCachedResource(activeServer, identity)
      .catch(() => undefined)
      .then(() => { if (retry) setAttempt((current) => current + 1) })
  }, [identity, memoryKey])

  return { complete, fail, generate, generationSnapshot, identity, invalidate, resource }
}

export function GroupAvatarGenerator({ complete, entries, fail, identity, server, snapshot, theme }: {
  complete: (resource: ResolvedResource) => void
  entries: AvatarMember[]
  fail: (error: unknown) => void
  identity: string
  server: ServerTarget
  size: number
  snapshot: GroupAvatarGenerationSnapshot
  theme: "light" | "dark"
  tokens: GroupAvatarVisualTokens
}) {
  const completeRef = useRef(complete)
  const failRef = useRef(fail)
  const serverRef = useRef(server)
  useEffect(() => {
    completeRef.current = complete
    failRef.current = fail
    serverRef.current = server
  }, [complete, fail, server])

  useEffect(() => {
    const activeServer = serverRef.current
    let active = true
    const ensureActive = () => {
      if (!active) throw new GroupAvatarOwnerUnmountedError()
    }
    const generateSvg = async () => {
      await waitForNextFrame()
      ensureActive()
      if (!epochs.isCurrent(activeServer, snapshot)) throw new GroupAvatarGenerationInvalidatedError()
      const svg = buildCompositeAvatar(entries, theme)
      ensureActive()
      if (!epochs.isCurrent(activeServer, snapshot)) throw new GroupAvatarGenerationInvalidatedError()
      const target = await createResourceCacheTarget(activeServer, identity, ".svg", { versioned: true })
      const temporaryUri = target.temporaryFile.uri
      try {
        target.temporaryFile.write(svg)
        const resource = await commitResourceCacheTarget(target, new TextEncoder().encode(svg).byteLength)
        ensureActive()
        if (!epochs.isCurrent(activeServer, snapshot)) {
          await removeCachedResource(activeServer, identity)
          throw new GroupAvatarGenerationInvalidatedError()
        }
        completeRef.current(resource)
      } finally {
        // File.move updates the source object's URI to the destination.
        const temporaryFile = new File(temporaryUri)
        if (temporaryFile.exists) temporaryFile.delete()
      }
    }
    const queued = generationQueue.then(generateSvg)
    const handled = queued.catch((error) => { if (active) failRef.current(error) })
    generationQueue = handled.then(() => undefined, () => undefined)
    return () => { active = false }
  }, [entries, identity, snapshot, theme])

  return null
}

function buildCompositeAvatar(entries: AvatarMember[], theme: "light" | "dark") {
  const tiles: CompositeAvatarTile[] = entries.map((member) => ({
    type: member.type === "app" ? "app" : "user",
  }))
  return buildGroupAvatarSvg(tiles, theme, GROUP_AVATAR_OUTPUT_SIZE)
}

export function CompositeImage({ fallback, onError, uri }: { fallback?: ReactNode; onError: () => void; uri: string }) {
  const [xml, setXml] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    new File(uri).text().then((value) => {
      if (active) setXml(value)
    }).catch(() => {
      if (active) onError()
    })
    return () => { active = false }
  }, [onError, uri])
  return xml ? <SvgXml height="100%" width="100%" onError={onError} xml={xml} style={[StyleSheet.absoluteFill, { zIndex: 0 }]} /> : fallback ?? null
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
