export type RealtimeDispatchTask = () => void | Promise<void>

export type RealtimeDispatchTarget = {
  enqueue: (task: RealtimeDispatchTask) => void
  dispose: () => void
}

/** Serializes realtime projection work and invalidates queued work on target changes. */
export class RealtimeDispatcher {
  private generation = 0
  private tail: Promise<void> = Promise.resolve()

  activate(onError: (error: unknown) => void): RealtimeDispatchTarget {
    const generation = ++this.generation
    let active = true

    return {
      enqueue: (task) => {
        this.tail = this.tail
          .catch(() => undefined)
          .then(async () => {
            if (!active || generation !== this.generation) return
            await task()
          })
          .catch((error: unknown) => {
            if (active && generation === this.generation) onError(error)
          })
      },
      dispose: () => {
        if (!active) return
        active = false
        if (generation === this.generation) this.generation += 1
      },
    }
  }
}
