import { File } from "expo-file-system"
// eslint-disable-next-line import/no-unresolved
import IconUser from "@tabler/icons-react-native/IconUser"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image as NativeImage, Platform, StyleSheet, View } from "react-native"
import { captureRef, releaseCapture } from "react-native-view-shot"

import { CachedAvatarTileImage } from "@/components/avatar/cached-avatar-image"
import {
  createGroupAvatarIdentity,
  GroupAvatarGenerationLimiter,
  GROUP_AVATAR_OUTPUT_SIZE,
  GroupAvatarGenerationEpoch,
  GroupAvatarMemoryCache,
  type GroupAvatarGenerationSnapshot,
  type GroupAvatarVisualTokens,
} from "@/components/avatar/group-avatar-cache"
import {
  AVATAR_FALLBACK_ICON_STROKE_WIDTH,
  getGroupAvatarFallbackIconSize,
  getGroupAvatarGridSize,
  type AvatarMember,
} from "@/components/avatar/avatar-strategy"
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
let captureQueue = Promise.resolve()
subscribeResourceCacheCleared((server) => {
  epochs.invalidate(server)
  if (server) memory.clearServer(server)
  else memory.clear()
})

class GroupAvatarOwnerUnmountedError extends Error {
  constructor() {
    super("Group avatar capture owner unmounted")
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
    resource: memory.get(memoryKey) ?? null,
  }))
  const resource =
    resourceState.memoryKey === memoryKey ? resourceState.resource : null
  const [generate, setGenerate] = useState(false)
  const [generationSnapshot, setGenerationSnapshot] =
    useState<GroupAvatarGenerationSnapshot | null>(null)
  const [attempt, setAttempt] = useState(0)
  const resolver = useRef<((resource: ResolvedResource) => void) | null>(null)
  const rejecter = useRef<((error: unknown) => void) | null>(null)
  const releaseGenerationRef = useRef<(() => void) | null>(null)
  const serverRef = useRef(server)
  useEffect(() => {
    serverRef.current = server
  }, [server])

  useEffect(() => {
    if (Platform.OS === "web") return
    const activeServer = serverRef.current
    let active = true
    const cached = memory.get(memoryKey)
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
        void getCachedResource(activeServer, identity).then((disk) => {
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
        if (
          active &&
          (error instanceof GroupAvatarOwnerUnmountedError ||
            error instanceof GroupAvatarGenerationInvalidatedError)
        ) {
          setAttempt((current) => current + 1)
        }
      }
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

  const complete = useCallback(
    (value: ResolvedResource) => {
      const activeServer = serverRef.current
      if (
        !generationSnapshot ||
        !epochs.isCurrent(activeServer, generationSnapshot)
      ) {
        rejecter.current?.(new GroupAvatarGenerationInvalidatedError())
        void removeCachedResource(activeServer, identity)
      } else {
        resolver.current?.(value)
      }
      releaseGeneration()
      setGenerate(false)
    },
    [generationSnapshot, identity, releaseGeneration]
  )
  const fail = useCallback((error: unknown) => {
    rejecter.current?.(error)
    releaseGeneration()
    setGenerate(false)
  }, [releaseGeneration])
  const invalidate = useCallback(() => {
    const activeServer = serverRef.current
    memory.delete(memoryKey)
    setResourceState({ memoryKey, resource: null })
    void removeCachedResource(activeServer, identity).finally(() => {
      setAttempt((current) => current + 1)
    })
  }, [identity, memoryKey])

  return { complete, fail, generate, generationSnapshot, identity, invalidate, resource }
}

export function GroupAvatarGenerator({ complete, entries, fail, identity, server, size, snapshot, tokens }: {
  complete: (resource: ResolvedResource) => void
  entries: AvatarMember[]
  fail: (error: unknown) => void
  identity: string
  server: ServerTarget
  size: number
  snapshot: GroupAvatarGenerationSnapshot
  tokens: GroupAvatarVisualTokens
}) {
  const ref = useRef<View>(null)
  const completeRef = useRef(complete)
  const failRef = useRef(fail)
  const serverRef = useRef(server)
  useEffect(() => {
    completeRef.current = complete
    failRef.current = fail
    serverRef.current = server
  }, [complete, fail, server])
  const ready = useRef(new Set<number>())
  const [readyCount, setReadyCount] = useState(0)
  const gridSize = getGroupAvatarGridSize(entries.length)
  const rows = Array.from({ length: Math.ceil(entries.length / gridSize) }, (_, row) => entries.slice(row * gridSize, row * gridSize + gridSize))
  const markReady = (index: number) => {
    if (ready.current.has(index)) return
    ready.current.add(index)
    setReadyCount(ready.current.size)
  }

  useEffect(() => {
    const activeServer = serverRef.current
    if (readyCount !== entries.length || !ref.current) return
    let active = true
    const ensureActive = () => {
      if (!active) throw new GroupAvatarOwnerUnmountedError()
    }
    const capture = async () => {
      await waitForNextFrame()
      ensureActive()
      if (!epochs.isCurrent(activeServer, snapshot)) {
        throw new GroupAvatarGenerationInvalidatedError()
      }
      const uri = await captureRef(ref, {
        format: "png",
        height: GROUP_AVATAR_OUTPUT_SIZE,
        quality: 1,
        result: "tmpfile",
        width: GROUP_AVATAR_OUTPUT_SIZE,
      })
      let target: Awaited<ReturnType<typeof createResourceCacheTarget>> | null = null
      try {
        ensureActive()
        if (!epochs.isCurrent(activeServer, snapshot)) {
          throw new GroupAvatarGenerationInvalidatedError()
        }
        target = await createResourceCacheTarget(activeServer, identity, ".png")
        ensureActive()
        const source = new File(uri)
        const capturedBytes = await source.bytes()
        ensureActive()
        target.temporaryFile.write(capturedBytes)
        if (!epochs.isCurrent(activeServer, snapshot)) {
          throw new GroupAvatarGenerationInvalidatedError()
        }
        const copiedSize = capturedBytes.byteLength
        if (copiedSize <= 0) {
          throw new Error("Group avatar capture produced an empty PNG")
        }
        const resource = await commitResourceCacheTarget(target, copiedSize)
        target = null
        ensureActive()
        if (!epochs.isCurrent(activeServer, snapshot)) {
          await removeCachedResource(activeServer, identity)
          throw new GroupAvatarGenerationInvalidatedError()
        }
        completeRef.current(resource)
      } finally {
        if (target?.temporaryFile.exists) target.temporaryFile.delete()
        releaseCapture(uri)
      }
    }
    const queued = captureQueue.then(capture)
    const handled = queued.catch((error) => {
      if (active) failRef.current(error)
    })
    captureQueue = handled.then(() => undefined, () => undefined)
    return () => {
      active = false
    }
  }, [entries.length, identity, readyCount, size, snapshot])

  return (
    <View accessibilityElementsHidden collapsable={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" ref={ref} style={{ backgroundColor: tokens.background1, height: size, left: 0, overflow: "hidden", position: "absolute", top: 0, width: size, zIndex: 0 }}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ alignSelf: "center", backgroundColor: tokens.fallbackBackground, flexDirection: "row", height: size / gridSize }}>
            {row.map((member, columnIndex) => {
              const index = rowIndex * gridSize + columnIndex
              return <GroupTile key={`${member.name}-${index}`} member={member} onReady={() => markReady(index)} server={server} size={size / gridSize} tokens={tokens} />
            })}
          </View>
        ))}
      </View>
    </View>
  )
}

function GroupTile({ member, onReady, server, size, tokens }: { member: AvatarMember; onReady: () => void; server: ServerTarget; size: number; tokens: GroupAvatarVisualTokens }) {
  useEffect(() => { if (!member.avatar) onReady() }, [member.avatar, onReady])
  const overlap = StyleSheet.hairlineWidth
  return (
    <View style={{ alignItems: "center", backgroundColor: tokens.fallbackBackground, height: size, justifyContent: "center", width: size }}>
      <IconUser color={tokens.textOnColor} size={getGroupAvatarFallbackIconSize(size)} strokeWidth={AVATAR_FALLBACK_ICON_STROKE_WIDTH} />
      {member.avatar ? (
        <View style={{ backgroundColor: tokens.background1, bottom: -overlap, left: 0, position: "absolute", right: -overlap, top: 0 }}>
          <CachedAvatarTileImage avatar={member.avatar} onReady={onReady} server={server} />
        </View>
      ) : null}
    </View>
  )
}

export function CompositeImage({ onError, uri }: { onError: () => void; uri: string }) {
  return <NativeImage onError={onError} resizeMode="cover" source={{ uri }} style={[StyleSheet.absoluteFill, { zIndex: 2 }]} />
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
