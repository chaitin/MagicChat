import type { AuthenticatedTarget } from "@/core/server-target"

export type SessionBootstrapOperationName =
  | "messages"
  | "currentUser"
  | "contacts"
  | "projects"

export type SessionBootstrapPhase = "idle" | "running" | "ready" | "degraded"
export type SessionBootstrapOperations = Record<
  SessionBootstrapOperationName,
  (context: { isCurrent: () => boolean }) => Promise<unknown>
>

type OperationState = "idle" | "running" | "ready" | "failed"
export type SessionBootstrapSnapshot = {
  key: string
  phase: SessionBootstrapPhase
  localAvailable: boolean
  ready: boolean
  degraded: boolean
  error: Error | null
  operations: Readonly<Record<SessionBootstrapOperationName, OperationState>>
}

type Entry = {
  generation: number
  operations: SessionBootstrapOperations
  states: Record<SessionBootstrapOperationName, OperationState>
  errors: Partial<Record<SessionBootstrapOperationName, Error>>
  listeners: Set<() => void>
  inflight: Promise<void> | null
  snapshot: SessionBootstrapSnapshot
  unauthorizedNotified: boolean
  onUnauthorized?: () => void
}

const names: SessionBootstrapOperationName[] = [
  "messages", "currentUser", "contacts", "projects",
]

export function getSessionBootstrapKey(target: AuthenticatedTarget) {
  return `${target.id}\u0000${target.url}\u0000${target.userId}`
}

export class SessionBootstrapCoordinator {
  private entries = new Map<string, Entry>()
  private listeners = new Map<string, Set<() => void>>()
  private emptySnapshots = new Map<string, SessionBootstrapSnapshot>()

  private readonly isUnauthorized: (error: unknown) => boolean
  private readonly onUnauthorized: (target: AuthenticatedTarget) => void

  constructor(
    isUnauthorized: (error: unknown) => boolean = () => false,
    onUnauthorized: (target: AuthenticatedTarget) => void = () => undefined
  ) {
    this.isUnauthorized = isUnauthorized
    this.onUnauthorized = onUnauthorized
  }

  start(
    target: AuthenticatedTarget,
    operations: SessionBootstrapOperations,
    options: { onUnauthorized?: () => void } = {}
  ) {
    const key = getSessionBootstrapKey(target)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = this.createEntry(key, operations)
      entry.listeners = this.listeners.get(key) ?? new Set()
      this.entries.set(key, entry)
    }
    entry.onUnauthorized ??= options.onUnauthorized
    if (entry.inflight) return entry.inflight
    if (entry.snapshot.ready) return Promise.resolve()

    const generation = entry.generation
    const pending = names.filter((name) => entry!.states[name] !== "ready")
    for (const name of pending) entry.states[name] = "running"
    this.publish(entry)

    const runs = pending.map(async (name) => {
      try {
        await entry!.operations[name]({
          isCurrent: () => this.isCurrent(key, entry!, generation),
        })
        if (!this.isCurrent(key, entry!, generation)) return
        entry!.states[name] = "ready"
        delete entry!.errors[name]
      } catch (cause) {
        if (!this.isCurrent(key, entry!, generation)) return
        const error = cause instanceof Error ? cause : new Error("初始化失败")
        entry!.states[name] = "failed"
        entry!.errors[name] = error
        if (this.isUnauthorized(error) && !entry!.unauthorizedNotified) {
          entry!.unauthorizedNotified = true
          entry!.onUnauthorized?.()
          this.onUnauthorized(target)
        }
      } finally {
        if (this.isCurrent(key, entry!, generation)) this.publish(entry!)
      }
    })

    entry.inflight = Promise.all(runs).then(() => {
      if (!this.isCurrent(key, entry!, generation)) throw new Error("登录初始化已失效")
      const error = names.map((name) => entry!.errors[name]).find(Boolean)
      if (error) throw error
    }).finally(() => {
      if (this.isCurrent(key, entry!, generation)) entry!.inflight = null
    })
    return entry.inflight
  }

  refresh(target: AuthenticatedTarget) {
    const entry = this.entries.get(getSessionBootstrapKey(target))
    if (!entry) throw new Error("初始化尚未启动")
    return this.start(target, entry.operations)
  }

  getSnapshot(target: AuthenticatedTarget): SessionBootstrapSnapshot {
    const key = getSessionBootstrapKey(target)
    const snapshot = this.entries.get(key)?.snapshot
    if (snapshot) return snapshot

    let emptySnapshot = this.emptySnapshots.get(key)
    if (!emptySnapshot) {
      emptySnapshot = this.emptySnapshot(key)
      this.emptySnapshots.set(key, emptySnapshot)
    }
    return emptySnapshot
  }

  subscribe(target: AuthenticatedTarget, listener: () => void) {
    const key = getSessionBootstrapKey(target)
    let listeners = this.listeners.get(key)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(key)
    }
  }

  invalidate(target: AuthenticatedTarget) {
    const key = getSessionBootstrapKey(target)
    const entry = this.entries.get(key)
    if (!entry) return
    entry.generation += 1
    this.entries.delete(key)
    for (const listener of entry.listeners) listener()
    entry.listeners.clear()
    this.listeners.delete(key)
  }

  private createEntry(key: string, operations: SessionBootstrapOperations): Entry {
    const states = Object.fromEntries(names.map((name) => [name, "idle"])) as Entry["states"]
    return { generation: 0, operations, states, errors: {}, listeners: new Set(), inflight: null,
      snapshot: this.emptySnapshot(key), unauthorizedNotified: false }
  }

  private emptySnapshot(key: string): SessionBootstrapSnapshot {
    const operations = Object.fromEntries(names.map((name) => [name, "idle"])) as Entry["states"]
    return { key, phase: "idle", localAvailable: false, ready: false, degraded: false, error: null, operations }
  }

  private isCurrent(key: string, entry: Entry, generation: number) {
    return this.entries.get(key) === entry && entry.generation === generation
  }

  private publish(entry: Entry) {
    const errors = names.flatMap((name) => entry.errors[name] ? [entry.errors[name]!] : [])
    const allReady = names.every((name) => entry.states[name] === "ready")
    const running = names.some((name) => entry.states[name] === "running")
    const localAvailable = entry.states.currentUser === "ready" && entry.states.contacts === "ready"
    entry.snapshot = {
      key: entry.snapshot.key,
      phase: allReady ? "ready" : errors.length && !running ? "degraded" : "running",
      localAvailable, ready: allReady, degraded: errors.length > 0,
      error: errors[0] ?? null, operations: { ...entry.states },
    }
    for (const listener of entry.listeners) listener()
  }
}
