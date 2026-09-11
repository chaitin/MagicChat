import type { AvatarMember } from "@/components/avatar/avatar-strategy"
import type { ServerTarget } from "@/core/server-target"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

export const GROUP_AVATAR_GENERATOR_VERSION = 9
export const GROUP_AVATAR_OUTPUT_SIZE = 192

type PendingGeneration = {
  cancelled: boolean
  release: (() => void) | null
  start: (release: () => void) => void
}

export class GroupAvatarGenerationLimiter {
  private active = 0
  private readonly maximum: number
  private readonly pending: PendingGeneration[] = []

  constructor(maximum = 2) {
    this.maximum = Math.max(1, maximum)
  }

  schedule(start: PendingGeneration["start"]) {
    const generation: PendingGeneration = {
      cancelled: false,
      release: null,
      start,
    }
    this.pending.push(generation)
    this.drain()

    return () => {
      if (generation.cancelled) return
      generation.cancelled = true
      generation.release?.()
    }
  }

  private drain() {
    while (this.active < this.maximum) {
      const generation = this.pending.shift()
      if (!generation) return
      if (generation.cancelled) continue

      this.active += 1
      let released = false
      generation.release = () => {
        if (released) return
        released = true
        this.active -= 1
        this.drain()
      }
      generation.start(generation.release)
    }
  }
}

export type GroupAvatarVisualTokens = {
  background1: string
  fallbackBackground: string
  textOnColor: string
}

export type GroupAvatarGenerationSnapshot = {
  global: number
  server: number
}

export class GroupAvatarGenerationEpoch {
  private global = 0
  private readonly servers = new Map<string, number>()

  capture(server: ServerTarget): GroupAvatarGenerationSnapshot {
    return {
      global: this.global,
      server: this.servers.get(createServerKey(server)) ?? 0,
    }
  }

  invalidate(server: ServerTarget | null) {
    if (!server) {
      this.global += 1
      this.servers.clear()
      return
    }
    const key = createServerKey(server)
    this.servers.set(key, (this.servers.get(key) ?? 0) + 1)
  }

  isCurrent(server: ServerTarget, snapshot: GroupAvatarGenerationSnapshot) {
    return (
      snapshot.global === this.global &&
      snapshot.server === (this.servers.get(createServerKey(server)) ?? 0)
    )
  }
}

export function createGroupAvatarIdentity({
  entries,
  gridSize,
  server,
  theme,
  tokens,
  version = GROUP_AVATAR_GENERATOR_VERSION,
}: {
  entries: AvatarMember[]
  gridSize: 2 | 3
  server: ServerTarget
  theme: "light" | "dark"
  tokens: GroupAvatarVisualTokens
  version?: number
}) {
  const input = JSON.stringify({
    entries: entries.map((member) => ({
      avatar: member.avatar,
      avatarType: member.type ?? "user",
      fallbackName: member.nickname || member.name,
      identity: member.id ?? member.name,
      resolvedAvatar: member.avatar
        ? resolveAvatar(server.url, member.avatar)
        : "",
      role: member.role,
    })),
    gridSize,
    limit: gridSize === 2 ? 4 : 9,
    server: { id: server.id, url: server.url },
    theme,
    tokens,
    version,
  })
  return `group-avatar:${hashString(input)}`
}

function resolveAvatar(serverUrl: string, avatar: string) {
  const resolved = resolveServerAssetUrl(serverUrl, avatar).trim()
  try {
    const url = new URL(resolved)
    url.hash = ""
    return url.toString()
  } catch {
    return resolved
  }
}

export function hashString(value: string) {
  const fnv = (seed: number) => {
    let hash = seed
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
  }
  return `${fnv(0x811c9dc5)}${fnv(0x9e3779b9)}`
}

export class GroupAvatarMemoryCache<T> {
  private readonly values = new Map<string, T>()
  private readonly maximum: number
  constructor(maximum = 128) { this.maximum = maximum }
  get(key: string) {
    const value = this.values.get(key)
    if (value === undefined) return undefined
    this.values.delete(key)
    this.values.set(key, value)
    return value
  }
  set(key: string, value: T) {
    this.values.delete(key)
    this.values.set(key, value)
    while (this.values.size > this.maximum) {
      const oldest = this.values.keys().next().value
      if (oldest === undefined) break
      this.values.delete(oldest)
    }
  }
  delete(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
  clearServer(server: ServerTarget) {
    const prefix = `${server.id}\n${server.url}\n`
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key)
  }
}

function createServerKey(server: ServerTarget) {
  return `${server.id}\n${server.url}`
}
