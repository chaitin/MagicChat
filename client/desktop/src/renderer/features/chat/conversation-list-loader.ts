export function createCoalescedConversationListLoader<T>(
  load: () => Promise<T>,
  onResult: (value: T) => void,
  onError: (error: unknown) => void,
) {
  let disposed = false
  let reading = false
  let dirty = false

  async function process() {
    do {
      dirty = false
      try {
        const result = await load()
        if (!disposed && !dirty) onResult(result)
      } catch (error) {
        if (!disposed && !dirty) onError(error)
      }
    } while (!disposed && dirty)
    reading = false
  }

  return {
    request() {
      if (disposed) return
      if (reading) {
        dirty = true
        return
      }
      reading = true
      void process()
    },
    dispose() {
      disposed = true
    },
  }
}
