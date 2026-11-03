export function createSubscriptionMultiplexer<T>(
  attach: (dispatch: (value: T) => void) => () => void,
): (callback: (value: T) => void) => () => void {
  const subscribers = new Set<(value: T) => void>()
  let detach: (() => void) | undefined

  const dispatch = (value: T) => {
    for (const subscriber of [...subscribers]) {
      subscriber(value)
    }
  }

  return (callback) => {
    const subscriber = (value: T) => callback(value)
    subscribers.add(subscriber)

    if (!detach) {
      try {
        detach = attach(dispatch)
      } catch (error) {
        subscribers.delete(subscriber)
        throw error
      }
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      subscribers.delete(subscriber)

      if (subscribers.size === 0) {
        const detachCurrent = detach
        detach = undefined
        detachCurrent?.()
      }
    }
  }
}
