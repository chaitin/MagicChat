export type EntityReference = { type: "user" | "app" | "group"; id: string }
export type EntityChange = { entity: EntityReference; revision: number }

export const entityChangeEvents = [
  "user.profile.updated",
  "app.profile.updated",
  "conversation.updated",
  "conversation.members.updated",
] as const

export function entityKey(entity: EntityReference) {
  return `${entity.type}:${entity.id}`
}

export function preserveEntityMetadata<T extends { entityRevision?: number }>(current: T | null | undefined, incoming: T): T {
  if (!current || (current.entityRevision ?? 0) <= (incoming.entityRevision ?? 0)) return incoming
  const next = { ...incoming, entityRevision: current.entityRevision }
  for (const field of ["announcement", "avatar", "avatarMembers", "canSend", "description", "joined", "memberCount", "members", "name", "visibility"]) {
    if (field in current) Object.assign(next, { [field]: current[field as keyof T] })
  }
  return next
}

export type EntityWireSnapshot = {
  users: Record<string, unknown>[]
  apps: Record<string, unknown>[]
  groups: Record<string, unknown>[]
  conversations: Record<string, unknown>[]
  versions: Record<string, number>
  removed: EntityReference[]
}

export function readEntitySnapshot(value: unknown): EntityWireSnapshot {
  const record = (entry: unknown): entry is Record<string, unknown> =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
  if (!record(value)) throw new Error("实体同步响应格式不正确")
  for (const field of ["users", "apps", "groups", "conversations"] as const) {
    if (!Array.isArray(value[field]) || !value[field].every(record)) throw new Error("实体同步响应格式不正确")
  }
  if (!record(value.versions) || Object.values(value.versions).some((revision) =>
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) ||
    !Array.isArray(value.removed) || value.removed.some((entry) =>
      !record(entry) || !["user", "app", "group"].includes(String(entry.type)) || typeof entry.id !== "string" || !entry.id)) {
    throw new Error("实体同步响应格式不正确")
  }
  return value as EntityWireSnapshot
}

export function parseEntityChange(event: string, payload: unknown): EntityChange | null {
  if (!(entityChangeEvents as readonly string[]).includes(event)) return null
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  if (event === "conversation.updated" && value.reason !== undefined) return null
  const type = event === "user.profile.updated" ? "user" : event === "app.profile.updated" ? "app" : "group"
  const id = value[type === "group" ? "conversation_id" : `${type}_id`]
  const revision = value.revision ?? 0
  if (typeof id !== "string" || !id.trim() || id.length > 128 ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null
  return { entity: { type, id: id.trim() }, revision }
}

type Pending = EntityChange & { epoch: number; force: boolean }
type SyncOptions<Snapshot> = {
  resolve: (entities: EntityReference[]) => Promise<Snapshot>
  version: (snapshot: Snapshot, entity: EntityReference) => number | null
  apply: (snapshot: Snapshot, entities: EntityReference[], isCurrent: (entity: EntityReference) => boolean) => Promise<void>
  isCurrent: () => boolean
  onError: (error: unknown) => void
  retryDelayMs?: number
}

/** One instance per authenticated runtime, never shared between accounts. */
export class EntitySynchronizer<Snapshot> {
  private pending = new Map<string, Pending>()
  private applied = new Map<string, number>()
  private epochs = new Map<string, number>()
  private inFlight: Promise<void> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  private readonly options: SyncOptions<Snapshot>

  constructor(options: SyncOptions<Snapshot>) { this.options = options }

  notify(event: string, payload: unknown) {
    const change = parseEntityChange(event, payload)
    if (!change) return false
    this.enqueue(change, false)
    this.start()
    return true
  }

  async refresh(entities: EntityReference[]) {
    for (const entity of entities) this.enqueue({ entity, revision: 0 }, true)
    await this.flush()
  }

  forget(entity: EntityReference) {
    const key = entityKey(entity)
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1)
    this.pending.delete(key)
    this.applied.delete(key)
  }

  dispose() {
    this.disposed = true
    this.pending.clear()
    if (this.retry) clearTimeout(this.retry)
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const operation = this.run().finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined
      if (this.pending.size && !this.retry && this.current()) this.start()
    })
    this.inFlight = operation
    return operation
  }

  private current() { return !this.disposed && this.options.isCurrent() }

  private enqueue(change: EntityChange, force: boolean) {
    if (!this.current()) return
    const key = entityKey(change.entity)
    if (!force && change.revision > 0 && change.revision <= (this.applied.get(key) ?? -1)) return
    const previous = this.pending.get(key)
    this.pending.set(key, {
      ...change,
      revision: Math.max(change.revision, previous?.revision ?? 0),
      epoch: this.epochs.get(key) ?? 0,
      force: force || previous?.force === true,
    })
  }

  private start() {
    if (this.inFlight || this.retry || !this.current()) return
    // Coalesce events received in the same transport turn without delaying permissions.
    queueMicrotask(() => {
      if (!this.inFlight && !this.retry && this.pending.size && this.current()) {
        void this.flush().catch(this.options.onError)
      }
    })
  }

  private deferRetry() {
    if (this.retry || !this.current()) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.start()
    }, this.options.retryDelayMs ?? 1_000)
  }

  private async run() {
    while (this.pending.size && this.current()) {
      let groups = 0
      // Full group snapshots may contain 1,000 members. Bound response size as
      // well as entity count during reconnect reconciliation.
      const batch = [...this.pending.values()].filter((item) => item.entity.type !== "group" || groups++ < 4).slice(0, 100)
      for (const item of batch) this.pending.delete(entityKey(item.entity))
      try {
        const snapshot = await this.options.resolve(batch.map((item) => item.entity))
        if (!this.current()) return
        const epochs = new Map(batch.map((item) => [entityKey(item.entity), item.epoch]))
        const isCurrent = (entity: EntityReference) => this.current() &&
          (this.epochs.get(entityKey(entity)) ?? 0) === epochs.get(entityKey(entity))
        let behind = false
        const eligible = batch.filter((item) => {
          if (!isCurrent(item.entity)) return false
          const key = entityKey(item.entity)
          const next = this.pending.get(key)
          const version = this.options.version(snapshot, item.entity)
          if ((version !== null && version < Math.max(item.revision, next?.revision ?? 0)) ||
            (version === null && next && next.revision > item.revision)) {
            this.enqueue(item, item.force)
            if (version !== null && version < item.revision) behind = true
            return false
          }
          if (next && !next.force && (version === null || next.revision <= version)) this.pending.delete(key)
          return true
        })
        if (eligible.length) await this.options.apply(snapshot, eligible.map((item) => item.entity), isCurrent)
        for (const item of eligible) {
          if (!isCurrent(item.entity)) continue
          const key = entityKey(item.entity)
          this.applied.set(key, Math.max(this.applied.get(key) ?? 0, this.options.version(snapshot, item.entity) ?? item.revision))
        }
        if (behind && this.pending.size) {
          this.deferRetry()
          return
        }
      } catch (error) {
        for (const item of batch) {
          if ((this.epochs.get(entityKey(item.entity)) ?? 0) === item.epoch) this.enqueue(item, item.force)
        }
        this.deferRetry()
        throw error
      }
    }
  }
}
