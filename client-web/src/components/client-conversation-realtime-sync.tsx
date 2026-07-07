import * as React from "react"
import { useLocation } from "react-router"

import { normalizeMessageCreatedEventPayload } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

export function ClientConversationRealtimeSync() {
  const location = useLocation()
  const { ready: realtimeReady, subscribeRealtimeEvent } = useRealtime()
  const { handleIncomingConversationMessage, syncLoadedConversationMessages } =
    useClientData()
  const previousRealtimeReadyRef = React.useRef(realtimeReady)
  const activeConversationId = React.useMemo(
    () => new URLSearchParams(location.search).get("conversation_id") ?? "",
    [location.search]
  )

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.created", (payload) => {
      try {
        handleIncomingConversationMessage(normalizeMessageCreatedEventPayload(payload), {
          activeConversationId,
          visible: document.visibilityState === "visible",
        })
      } catch {
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [
    activeConversationId,
    handleIncomingConversationMessage,
    subscribeRealtimeEvent,
  ])

  React.useEffect(() => {
    const wasReady = previousRealtimeReadyRef.current
    previousRealtimeReadyRef.current = realtimeReady

    if (!realtimeReady || wasReady) {
      return
    }

    syncLoadedConversationMessages()
  }, [realtimeReady, syncLoadedConversationMessages])

  return null
}
