import { useEffect, useRef, useState } from "react"

const TARGET_MESSAGE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const

type TargetMessageNavigationOptions = {
  fetchOlderMessages: () => Promise<{ isError: boolean }>
  hasOlder: boolean
  isFetchingOlder: boolean
  isLoading: boolean
  messages: readonly { id: string }[]
  targetMessageId: string
  scopeKey?: string
  requestKey?: number
  onUnavailable?: () => void
}

export function useTargetMessageNavigation({
  fetchOlderMessages,
  hasOlder,
  isFetchingOlder,
  isLoading,
  messages,
  targetMessageId,
  scopeKey,
  requestKey = 0,
  onUnavailable,
}: TargetMessageNavigationOptions) {
  const boundaryRef = useRef("")
  const generationRef = useRef(0)
  const reportedUnavailableRef = useRef(false)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    generationRef.current += 1
    boundaryRef.current = ""
    reportedUnavailableRef.current = false
    retryCountRef.current = 0
    clearTimeout(retryTimerRef.current)
    return () => {
      generationRef.current += 1
      clearTimeout(retryTimerRef.current)
    }
  }, [scopeKey, requestKey, targetMessageId])

  useEffect(() => {
    if (
      !targetMessageId ||
      isLoading ||
      isFetchingOlder ||
      messages.some((message) => message.id === targetMessageId)
    ) {
      return
    }
    if (!hasOlder) {
      if (!reportedUnavailableRef.current) {
        reportedUnavailableRef.current = true
        onUnavailable?.()
      }
      return
    }
    const generation = generationRef.current
    const oldestMessageId = messages.at(-1)?.id ?? "empty"
    const boundary = `${targetMessageId}:${oldestMessageId}`
    if (boundaryRef.current === boundary) return
    boundaryRef.current = boundary
    const scheduleRetry = () => {
      if (generationRef.current !== generation) return
      const retryIndex = Math.min(
        retryCountRef.current,
        TARGET_MESSAGE_RETRY_DELAYS_MS.length - 1
      )
      retryCountRef.current += 1
      retryTimerRef.current = setTimeout(() => {
        if (generationRef.current !== generation) return
        if (boundaryRef.current === boundary) {
          boundaryRef.current = ""
        }
        setAttempt((current) => current + 1)
      }, TARGET_MESSAGE_RETRY_DELAYS_MS[retryIndex])
    }
    void fetchOlderMessages()
      .then((result) => {
        if (generationRef.current !== generation) return
        if (result.isError) {
          scheduleRetry()
          return
        }
        retryCountRef.current = 0
        clearTimeout(retryTimerRef.current)
      })
      .catch(scheduleRetry)
  }, [
    attempt,
    fetchOlderMessages,
    hasOlder,
    isFetchingOlder,
    isLoading,
    messages,
    onUnavailable,
    requestKey,
    scopeKey,
    targetMessageId,
  ])
}
