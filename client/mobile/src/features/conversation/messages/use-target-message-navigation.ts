import { useEffect, useRef, useState } from "react"

const TARGET_MESSAGE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const

type TargetMessageNavigationOptions = {
  fetchOlderMessages: () => Promise<{ isError: boolean }>
  hasOlder: boolean
  isFetchingOlder: boolean
  isLoading: boolean
  messages: readonly { id: string }[]
  targetMessageId: string
}

export function useTargetMessageNavigation({
  fetchOlderMessages,
  hasOlder,
  isFetchingOlder,
  isLoading,
  messages,
  targetMessageId,
}: TargetMessageNavigationOptions) {
  const boundaryRef = useRef("")
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    boundaryRef.current = ""
    retryCountRef.current = 0
    clearTimeout(retryTimerRef.current)
    return () => clearTimeout(retryTimerRef.current)
  }, [targetMessageId])

  useEffect(() => {
    if (
      !targetMessageId ||
      isLoading ||
      isFetchingOlder ||
      !hasOlder ||
      messages.some((message) => message.id === targetMessageId)
    ) {
      return
    }
    const oldestMessageId = messages.at(-1)?.id ?? "empty"
    const boundary = `${targetMessageId}:${oldestMessageId}`
    if (boundaryRef.current === boundary) return
    boundaryRef.current = boundary
    const scheduleRetry = () => {
      const retryIndex = Math.min(
        retryCountRef.current,
        TARGET_MESSAGE_RETRY_DELAYS_MS.length - 1
      )
      retryCountRef.current += 1
      retryTimerRef.current = setTimeout(() => {
        if (boundaryRef.current === boundary) {
          boundaryRef.current = ""
        }
        setAttempt((current) => current + 1)
      }, TARGET_MESSAGE_RETRY_DELAYS_MS[retryIndex])
    }
    void fetchOlderMessages()
      .then((result) => {
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
    targetMessageId,
  ])
}
