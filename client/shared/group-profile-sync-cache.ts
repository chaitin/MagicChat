export const GROUP_PROFILE_CACHE_TTL_MS = 60 * 60 * 1_000

export type GroupProfileSyncState = {
  id: string
  syncedAt: number
  hasSnapshot: boolean
}

export function isGroupProfileFresh(state: GroupProfileSyncState | undefined, now: number) {
  if (!state?.hasSnapshot || !Number.isFinite(state.syncedAt) || state.syncedAt <= 0) return false
  const age = now - state.syncedAt
  return age >= 0 && age < GROUP_PROFILE_CACHE_TTL_MS
}

type GroupProfileCacheOptions = {
  read: (ids: string[]) => Promise<GroupProfileSyncState[]>
  write: (ids: string[], syncedAt: number) => Promise<void>
  remove: (ids: string[]) => Promise<void>
  isCurrent: () => boolean
  onError: (error: unknown) => void
  now?: () => number
}

/** One cache per server/account runtime; adapters persist timestamps with complete snapshots. */
export class GroupProfileSyncCache {
  private readonly generations = new Map<string, number>()
  private readonly invalidated = new Set<string>()
  private writes: Promise<void> = Promise.resolve()

  private readonly options: GroupProfileCacheOptions

  constructor(options: GroupProfileCacheOptions) { this.options = options }

  async stale(ids: string[]): Promise<string[]> {
    await this.writes
    const unique = [...new Set(ids)]
    if (!this.options.isCurrent()) return []
    const writes = this.writes
    const states = await this.options.read(unique)
    if (writes !== this.writes) return this.stale(unique)
    const byId = new Map(states.map((state) => [state.id, state]))
    const now = (this.options.now ?? Date.now)()
    return unique.filter((id) => this.invalidated.has(id) || !isGroupProfileFresh(byId.get(id), now))
  }

  checkpoint(ids: string[]) {
    return new Map(ids.map((id) => [id, this.generations.get(id) ?? 0]))
  }

  invalidate(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    this.invalidated.add(id)
    void this.enqueue(async () => {
      await this.options.remove([id])
    }).catch(this.options.onError)
  }

  async synced(ids: string[], checkpoint: Map<string, number>, isCurrent: (id: string) => boolean) {
    await this.enqueue(async () => {
      if (!this.options.isCurrent()) return
      const current = ids.filter((id) => isCurrent(id) &&
        checkpoint.get(id) === (this.generations.get(id) ?? 0))
      if (current.length) {
        await this.options.write(current, (this.options.now ?? Date.now)())
        for (const id of current) {
          if (checkpoint.get(id) === (this.generations.get(id) ?? 0)) this.invalidated.delete(id)
        }
      }
    })
  }

  private enqueue(work: () => Promise<void>) {
    const operation = this.writes.then(work)
    this.writes = operation.catch(() => undefined)
    return operation
  }
}
