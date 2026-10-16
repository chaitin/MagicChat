export const directoryUpdatedEvent = "contact.directory.updated"

type DirectorySyncOptions = {
  refresh: () => Promise<void>
  isCurrent: () => boolean
  onError: (error: unknown) => void
  retryDelayMs?: number
}

/** Different newly created entities can have the same server revision; use a
 * local request generation rather than deduplicating directory revisions. */
export class DirectorySynchronizer {
  private requested = 0
  private completed = 0
  private inFlight: Promise<void> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly options: DirectorySyncOptions

  constructor(options: DirectorySyncOptions) { this.options = options }

  notify(event: string, payload: unknown) {
    if (event !== directoryUpdatedEvent || !payload || typeof payload !== "object" || Array.isArray(payload)) return false
    const value = payload as Record<string, unknown>
    if ((value.scope !== "users" && value.scope !== "apps") || typeof value.revision !== "number" ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) return false
    if (this.current()) {
      this.requested += 1
      this.start()
    }
    return true
  }

  async refresh() {
    if (!this.current()) return
    this.requested += 1
    if (this.retry) { clearTimeout(this.retry); this.retry = undefined }
    await this.flush()
  }

  dispose() {
    this.disposed = true
    if (this.retry) clearTimeout(this.retry)
  }

  private current() { return !this.disposed && this.options.isCurrent() }

  private start() {
    if (this.inFlight || this.retry || !this.current()) return
    queueMicrotask(() => {
      if (!this.inFlight && !this.retry && this.current() && this.requested > this.completed) {
        void this.flush().catch(this.options.onError)
      }
    })
  }

  private flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const operation = this.run().finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined
      if (this.current() && this.requested > this.completed) this.start()
    })
    this.inFlight = operation
    return operation
  }

  private async run() {
    try {
      while (this.current() && this.completed < this.requested) {
        const generation = this.requested
        await this.options.refresh()
        if (!this.current()) return
        this.completed = generation
      }
    } catch (error) {
      if (this.current() && !this.retry) this.retry = setTimeout(() => {
        this.retry = undefined
        this.start()
      }, this.options.retryDelayMs ?? 1_000)
      throw error
    }
  }
}
