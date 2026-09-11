import { focusManager } from "@tanstack/react-query"
import { useEffect } from "react"

export function startManagerPolling(interval: number, refresh: (signal: AbortSignal) => Promise<unknown>, focused = () => focusManager.isFocused()) {
  const abort = new AbortController()
  const timer = setInterval(() => { if (focused()) void refresh(abort.signal).catch(() => undefined) }, interval)
  return () => { abort.abort(); clearInterval(timer) }
}

export function useManagerPolling(enabled: boolean, interval: number | false, refresh: (signal: AbortSignal) => Promise<unknown>) {
  useEffect(() => {
    if (!enabled || interval === false) return
    return startManagerPolling(interval, refresh)
  }, [enabled, interval, refresh])
}
