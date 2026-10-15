type RecoveryOptions = {
  enqueue: (task: () => Promise<void>) => void
  isCurrent: () => boolean
  onChange: (recovering: boolean) => void
  onError: (error: unknown) => void
  shouldRetry: (error: unknown) => boolean
  synchronize: () => Promise<void>
}

/** Tracks one connection's catch-up independently of ordinary background refreshes. */
export class RealtimeRecovery {
  private readonly options: RecoveryOptions
  private ready: boolean | null = null
  private disposed = false
  private generation = 0
  private recovered = false
  private running = false
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: RecoveryOptions) {
    this.options = options
  }

  get isRecovering() {
    return !this.recovered
  }

  setReady(ready: boolean) {
    if (this.disposed || ready === this.ready) return
    this.ready = ready
    this.generation += 1
    this.recovered = false
    this.running = false
    this.retryAttempt = 0
    this.clearRetry()
    this.options.onChange(true)
    if (ready) this.retry()
  }

  retry() {
    if (this.disposed || !this.ready || this.recovered || this.running || !this.options.isCurrent()) return
    this.clearRetry()
    const generation = this.generation
    this.running = true
    this.options.enqueue(async () => {
      if (!this.isCurrent(generation)) return
      try {
        await this.options.synchronize()
        if (this.isCurrent(generation)) {
          this.recovered = true
          this.options.onChange(false)
        }
      } catch (error) {
        if (!this.isCurrent(generation)) return
        this.options.onError(error)
        if (this.options.shouldRetry(error)) {
          const delay = Math.min(++this.retryAttempt, 30) * 1_000
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.retry()
          }, delay)
        }
      } finally {
        if (this.isCurrent(generation)) this.running = false
      }
    })
  }

  dispose() {
    this.disposed = true
    this.generation += 1
    this.clearRetry()
  }

  private isCurrent(generation: number) {
    return !this.disposed && this.ready === true && generation === this.generation && this.options.isCurrent()
  }

  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
