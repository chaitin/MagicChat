const BLINK_INTERVAL_MS = 500

type Timer = ReturnType<typeof setInterval>

type Options = {
  blink?: boolean
  showDimmed(dimmed: boolean): void
  setTaskbarAttention(enabled: boolean): void
  startTimer?: (callback: () => void, intervalMs: number) => Timer
  stopTimer?: (timer: Timer) => void
}

export function createUnreadAttention(options: Options) {
  let unread = false
  let focused = false
  let dimmed = false
  let timer: Timer | null = null
  const startTimer = options.startTimer ?? setInterval
  const stopTimer = options.stopTimer ?? clearInterval

  function setUnread(hasUnread: boolean) {
    if (unread === hasUnread) return
    unread = hasUnread
    if (unread && options.blink !== false) {
      timer = startTimer(() => {
        dimmed = !dimmed
        options.showDimmed(dimmed)
      }, BLINK_INTERVAL_MS)
    } else if (!unread) {
      if (timer !== null) stopTimer(timer)
      timer = null
      dimmed = false
      if (options.blink !== false) options.showDimmed(false)
    }
    options.setTaskbarAttention(unread && !focused)
  }

  return {
    setUnread,
    setWindowFocused(isFocused: boolean) {
      if (focused === isFocused) return
      focused = isFocused
      options.setTaskbarAttention(unread && !focused)
    },
    close: () => setUnread(false),
  }
}
