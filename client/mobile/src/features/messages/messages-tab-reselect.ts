const listeners = new Set<() => void>()

export function notifyMessagesTabReselected() {
  for (const listener of listeners) listener()
}

export function subscribeToMessagesTabReselected(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
