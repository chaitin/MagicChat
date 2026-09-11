export class SharedTaskPool<T> {
  private readonly tasks = new Map<string, Promise<T>>()
  private exclusiveBarrier: Promise<void> | null = null

  run(
    key: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(getAbortReason(signal))
    if (this.exclusiveBarrier) {
      const barrier = this.exclusiveBarrier
      return waitForSharedTask(
        barrier.then(() => this.run(key, operation, signal)),
        signal
      )
    }

    let task = this.tasks.get(key)
    if (!task) {
      const createdTask = Promise.resolve().then(operation)
      task = createdTask
      this.tasks.set(key, createdTask)
      createdTask.then(
        () => this.deleteIfCurrent(key, createdTask),
        () => this.deleteIfCurrent(key, createdTask)
      )
    }

    return waitForSharedTask(task, signal)
  }

  async runExclusive<R>(operation: () => Promise<R>): Promise<R> {
    while (this.exclusiveBarrier) await this.exclusiveBarrier

    let releaseBarrier: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    this.exclusiveBarrier = barrier
    const activeTasks = this.listAll()

    try {
      await Promise.allSettled(activeTasks)
      return await operation()
    } finally {
      if (this.exclusiveBarrier === barrier) this.exclusiveBarrier = null
      releaseBarrier()
    }
  }

  listAll() {
    return Array.from(this.tasks.values())
  }

  listByPrefix(prefix: string) {
    return Array.from(this.tasks)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, task]) => task)
  }

  private deleteIfCurrent(key: string, task: Promise<T>) {
    if (this.tasks.get(key) === task) this.tasks.delete(key)
  }
}

function waitForSharedTask<T>(task: Promise<T>, signal?: AbortSignal) {
  if (!signal) return task
  if (signal.aborted) return Promise.reject(getAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort)
      reject(getAbortReason(signal))
    }
    signal.addEventListener("abort", handleAbort, { once: true })

    task.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort)
        reject(error)
      }
    )
  })
}

function getAbortReason(signal: AbortSignal) {
  if (signal.reason !== undefined) return signal.reason

  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}
