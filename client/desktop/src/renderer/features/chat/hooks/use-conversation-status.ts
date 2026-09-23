import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  ConversationPresenceEvent,
  ConversationPresenceSender,
  DesktopConversation,
} from "../../../../shared/account-data"
import {
  CONVERSATION_STATUS_HEARTBEAT_MS,
  CONVERSATION_STATUS_TTL_MS,
  shouldSendConversationStatus,
} from "../conversation-status-policy"

type ReceivedStatus = {
  status: string
  sender: ConversationPresenceSender
}

export function useConversationStatus({
  targetId,
  conversation,
  draft,
  focused,
}: {
  targetId: string
  conversation: DesktopConversation | null
  draft: string
  focused: boolean
}) {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible")
  const [realtimeReady, setRealtimeReady] = useState(true)
  const [receivedStatuses, setReceivedStatuses] = useState<Map<string, ReceivedStatus>>(
    () => new Map(),
  )
  const statusesRef = useRef(new Map<string, ReceivedStatus>())
  const expiryTimersRef = useRef(new Map<string, number>())
  const heartbeatTimerRef = useRef<number | null>(null)
  const heartbeatConversationIdRef = useRef("")
  const previousConversationIdRef = useRef(conversation?.id ?? "")

  const publishStatuses = useCallback(() => {
    setReceivedStatuses(new Map(statusesRef.current))
  }, [])

  const clearStatus = useCallback(
    (conversationId: string) => {
      const timer = expiryTimersRef.current.get(conversationId)
      if (timer !== undefined) window.clearTimeout(timer)
      expiryTimersRef.current.delete(conversationId)
      if (statusesRef.current.delete(conversationId)) publishStatuses()
    },
    [publishStatuses],
  )

  const clearAllStatuses = useCallback(() => {
    for (const timer of expiryTimersRef.current.values()) window.clearTimeout(timer)
    expiryTimersRef.current.clear()
    if (statusesRef.current.size === 0) return
    statusesRef.current.clear()
    publishStatuses()
  }, [publishStatuses])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    heartbeatConversationIdRef.current = ""
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  useEffect(() => {
    if (!window.desktop) return
    const unsubscribePresence = window.desktop.accountData.onConversationPresenceChanged(
      (event: ConversationPresenceEvent) => {
        if (event.targetId !== targetId) return
        if (event.name === "conversation.status") {
          const previousTimer = expiryTimersRef.current.get(event.conversationId)
          if (previousTimer !== undefined) window.clearTimeout(previousTimer)
          statusesRef.current.set(event.conversationId, {
            status: event.status,
            sender: event.sender,
          })
          expiryTimersRef.current.set(
            event.conversationId,
            window.setTimeout(() => clearStatus(event.conversationId), CONVERSATION_STATUS_TTL_MS),
          )
          publishStatuses()
          return
        }
        const current = statusesRef.current.get(event.conversationId)
        if (current && sameSender(current.sender, event.sender)) clearStatus(event.conversationId)
      },
    )
    const unsubscribeSync = window.desktop.accountData.onSyncStateChange((event) => {
      if (event.targetId !== targetId) return
      setRealtimeReady(event.state === "ready")
      if (event.state === "loading") clearAllStatuses()
    })
    return () => {
      unsubscribePresence()
      unsubscribeSync()
      clearAllStatuses()
    }
  }, [clearAllStatuses, clearStatus, publishStatuses, targetId])

  useEffect(() => {
    const conversationId = conversation?.id ?? ""
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId
      stopHeartbeat()
      return
    }
    const shouldSend = shouldSendConversationStatus(
      conversation,
      draft,
      focused,
      visible,
      realtimeReady,
    )
    if (!shouldSend || !conversationId || !window.desktop) {
      stopHeartbeat()
      return
    }
    if (
      heartbeatTimerRef.current !== null &&
      heartbeatConversationIdRef.current === conversationId
    ) {
      return
    }
    stopHeartbeat()
    heartbeatConversationIdRef.current = conversationId
    const send = () => {
      void window.desktop?.accountData
        .sendConversationStatus({ targetId, conversationId })
        .catch(() => undefined)
    }
    send()
    heartbeatTimerRef.current = window.setInterval(send, CONVERSATION_STATUS_HEARTBEAT_MS)
  }, [conversation, draft, focused, realtimeReady, stopHeartbeat, targetId, visible])

  useEffect(() => stopHeartbeat, [stopHeartbeat])

  return useMemo(() => {
    if (
      !realtimeReady ||
      !conversation ||
      (conversation.type !== "direct" && conversation.type !== "app")
    ) {
      return undefined
    }
    return receivedStatuses.get(conversation.id)?.status
  }, [conversation, receivedStatuses])
}

function sameSender(left: ConversationPresenceSender, right: ConversationPresenceSender) {
  return left.id === right.id && left.type === right.type
}
