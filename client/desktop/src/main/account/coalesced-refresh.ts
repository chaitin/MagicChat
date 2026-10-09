export function coalesceRefresh(run: () => Promise<void>) {
  let inFlight: Promise<void> | null = null
  let pending = false

  return () => {
    if (inFlight) {
      pending = true
      return inFlight
    }
    const task = (async () => {
      let failed = false
      let failure: unknown
      do {
        pending = false
        try {
          await run()
          failed = false
        } catch (error) {
          failed = true
          failure = error
        }
      } while (pending)
      if (failed) throw failure
    })()
    inFlight = task.finally(() => {
      inFlight = null
    })
    return inFlight
  }
}
