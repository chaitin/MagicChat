import { useCallback, useEffect, useRef } from "react"

type HistoryMetrics = {
  contentHeight: number
  viewportHeight: number
  offset: number
}

export function useMessageHistoryPagination({
  conversationId,
  cursor,
  hasOlder,
  isLoading,
  isFetchingOlder,
  error,
  onLoadOlder,
}: {
  conversationId: string
  cursor: number | undefined
  hasOlder: boolean
  isLoading: boolean
  isFetchingOlder: boolean
  error: Error | null
  onLoadOlder: () => void
}) {
  const metricsRef = useRef<HistoryMetrics & { conversationId: string }>({
    conversationId,
    contentHeight: 0,
    viewportHeight: 0,
    offset: 0,
  })
  const attemptedCursorRef = useRef<string | null>(null)
  const requestOlder = useCallback((manual = false) => {
    if (!hasOlder || isLoading || isFetchingOlder || cursor === undefined) return
    const key = JSON.stringify([conversationId, cursor])
    // A failed or non-advancing page requires explicit retry, not an automatic loop.
    if (!manual && (error || attemptedCursorRef.current === key)) return
    attemptedCursorRef.current = key
    onLoadOlder()
  }, [conversationId, cursor, error, hasOlder, isFetchingOlder, isLoading, onLoadOlder])

  const checkBoundary = useCallback(() => {
    const metrics = metricsRef.current
    if (metrics.conversationId !== conversationId || metrics.viewportHeight <= 0 || metrics.contentHeight <= 0) return
    const remaining = metrics.contentHeight - metrics.viewportHeight - metrics.offset
    if (remaining <= metrics.viewportHeight * 0.2) requestOlder()
  }, [conversationId, requestOlder])

  const updateMetrics = useCallback((patch: Partial<HistoryMetrics>) => {
    if (metricsRef.current.conversationId !== conversationId) {
      metricsRef.current = { conversationId, contentHeight: 0, viewportHeight: 0, offset: 0 }
    }
    Object.assign(metricsRef.current, patch)
    checkBoundary()
  }, [checkBoundary, conversationId])

  useEffect(() => {
    // Recheck after loading/layout settles even if FlatList suppresses onEndReached.
    const frame = requestAnimationFrame(checkBoundary)
    return () => cancelAnimationFrame(frame)
  }, [checkBoundary])

  return {
    updateMetrics,
    onReachOlder: useCallback(() => requestOlder(), [requestOlder]),
    onRetryOlder: useCallback(() => requestOlder(true), [requestOlder]),
  }
}
