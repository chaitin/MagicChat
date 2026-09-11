import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"

import type { ClientConversation, ClientMessage } from "@/core/models"
import { ConversationReadTracker } from "@/features/conversation/conversation-read-tracker"

const READ_SYNC_INTERVAL_MS = 20_000

type MarkConversationRead = (
  upToSeq: number
) => Promise<{ lastReadSeq: number }>

export function useConversationReadSync({
  conversation,
  conversationId,
  isFocused,
  markRead,
  messages,
}: {
  conversation: ClientConversation | undefined
  conversationId: string
  isFocused: boolean
  markRead: MarkConversationRead
  messages: Pick<ClientMessage, "seq">[]
}) {
  const [appIsActive, setAppIsActive] = useState(
    () => AppState.currentState === "active"
  )
  const appIsActiveRef = useRef(appIsActive)
  const readTrackerRef = useRef(new ConversationReadTracker())

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      const active = status === "active"
      appIsActiveRef.current = active
      setAppIsActive(active)
    })

    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!conversation) return

    if (!isFocused || !appIsActiveRef.current) return

    function markLatestRead() {
      if (!appIsActiveRef.current) return

      const requestedSeq = readTrackerRef.current.nextRequest({
        conversationId,
        lastMessageSeq: conversation!.lastMessageSeq,
        lastReadSeq: conversation!.lastReadSeq,
        newestLoadedSeq: messages[0]?.seq ?? 0,
        unreadCount: conversation!.unreadCount,
      })
      if (requestedSeq === null) return

      void markRead(requestedSeq)
        .then((result) => {
          readTrackerRef.current.confirm(conversationId, result.lastReadSeq)
        })
        .catch(() => {
          readTrackerRef.current.fail(conversationId, requestedSeq)
        })
    }

    markLatestRead()
    const interval = setInterval(markLatestRead, READ_SYNC_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [
    appIsActive,
    conversation,
    conversationId,
    isFocused,
    markRead,
    messages,
  ])
}
