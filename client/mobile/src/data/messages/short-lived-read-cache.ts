type Entry<T> = {
  promise: Promise<T>
  expiresAt: number | null
  invalidated: boolean
  unsubscribe: () => void
  timer?: ReturnType<typeof setTimeout>
}

export function createShortLivedReadCache<T>(reuseMs: number) {
  const entries = new Map<string, Entry<T>>()

  function invalidate(key: string) {
    const entry = entries.get(key)
    if (!entry) return
    entry.invalidated = true
    entries.delete(key)
    clearTimeout(entry.timer)
    entry.unsubscribe()
  }

  function read(
    key: string,
    load: () => Promise<T>,
    subscribe: (invalidate: () => void) => () => void,
    retries = 0
  ): { promise: Promise<T>; reused: boolean } {
    const current = entries.get(key)
    if (current && (current.expiresAt === null || Date.now() < current.expiresAt)) {
      return { promise: settled(current, key, load, subscribe, retries), reused: true }
    }
    if (current) invalidate(key)

    const entry: Entry<T> = {
      expiresAt: null,
      invalidated: false,
      promise: Promise.resolve().then(load),
      unsubscribe: () => undefined,
    }
    entries.set(key, entry)
    entry.unsubscribe = subscribe(() => invalidate(key))
    void entry.promise.then(
      () => {
        if (entries.get(key) !== entry) return
        entry.expiresAt = Date.now() + reuseMs
        entry.timer = setTimeout(() => {
          if (entries.get(key) === entry) invalidate(key)
        }, reuseMs)
      },
      () => {
        if (entries.get(key) === entry) invalidate(key)
      }
    )
    return { promise: settled(entry, key, load, subscribe, retries), reused: false }
  }

  function settled(
    entry: Entry<T>,
    key: string,
    load: () => Promise<T>,
    subscribe: (invalidate: () => void) => () => void,
    retries: number
  ): Promise<T> {
    return entry.promise.then((result) =>
      entry.invalidated && retries === 0
        ? read(key, load, subscribe, 1).promise
        : result
    )
  }

  return { invalidate, read }
}
