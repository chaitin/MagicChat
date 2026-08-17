import * as React from "react"
import { matchPath, useLocation, useNavigate } from "react-router"

import {
  normalizeConversationMuteUpdatedEventPayload,
  normalizeConversationPinUpdatedEventPayload,
  normalizeConversationMemberMentionedEventPayload,
  normalizeConversationMemberChoiceReceivedEventPayload,
  normalizeConversationRemovedEventPayload,
  normalizeMessageCreatedEventPayload,
  normalizeMessageUpdatedEventPayload,
  normalizeMessageReactionsUpdatedEventPayload,
  normalizeMessageChoiceUpdatedEventPayload,
  normalizeTopicEventPayload,
} from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"
import { recordRealtimeParseFailure } from "@/lib/desktop-diagnostics"

export function ClientConversationRealtimeSync() {
  const location = useLocation()
  const navigate = useNavigate()
  const { ready: realtimeReady, subscribeRealtimeEvent } = useRealtime()
  const {
    foregroundConversationId,
    handleIncomingConversationMessage,
    handleIncomingConversationMessageUpdate,
    handleIncomingMessageChoiceUpdate,
    handleIncomingMessageReactionsUpdate,
    refreshConversations,
    removeConversation,
    syncLoadedConversationMessages,
    updateConversationLastMentionedSeq,
    updateConversationLastChoiceSeq,
    updateConversationMuted,
    updateConversationPinned,
    updateMessageTopic,
  } = useClientData()
  // 子组件只会在 Realtime 已 ready 后首次挂载，因此不能用当前 ready 值
  // 初始化 previous，否则首次挂载会被误判为一次已经处理过的 ready 边沿。
  const hasSeenRealtimeReadyRef = React.useRef(false)
  const previousRealtimeReadyRef = React.useRef<boolean | null>(null)
  const recoveryInProgressRef = React.useRef<Promise<void> | null>(null)
  const activeConversationId = React.useMemo(
    () => matchPath("/chat/:conversationId", location.pathname)?.params.conversationId ?? "",
    [location.pathname],
  )
  const visibleConversationId = foregroundConversationId || activeConversationId

  const recoverAfterRealtimeReady = React.useCallback(() => {
    if (recoveryInProgressRef.current) return
    const recovery = refreshConversations()
      .catch(() => undefined)
      .then(() => {
        // 会话列表刷新会按新摘要调度持久游标追赶；这里同时修复已加载内存时间线。
        syncLoadedConversationMessages()
      })
    recoveryInProgressRef.current = recovery
    void recovery.finally(() => {
      if (recoveryInProgressRef.current === recovery) recoveryInProgressRef.current = null
    })
  }, [refreshConversations, syncLoadedConversationMessages])

  React.useEffect(
    () => subscribeRealtimeEvent("system.ready", recoverAfterRealtimeReady),
    [recoverAfterRealtimeReady, subscribeRealtimeEvent],
  )

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.created", (payload) => {
      try {
        const message = normalizeMessageCreatedEventPayload(payload)
        handleIncomingConversationMessage(message, {
          activeConversationId: visibleConversationId,
          visible: document.visibilityState === "visible",
        })
        if (
          message.body.type === "system_event" &&
          (message.body.event === "group_avatar_updated" ||
            message.body.event === "group_name_updated" ||
            message.body.event === "group_announcement_updated" ||
            message.body.event === "group_member_left" ||
            message.body.event === "group_member_removed")
        ) {
          void refreshConversations().catch(() => undefined)
        }
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [
    handleIncomingConversationMessage,
    refreshConversations,
    subscribeRealtimeEvent,
    visibleConversationId,
  ])

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.updated", (payload) => {
      try {
        const message = normalizeMessageUpdatedEventPayload(payload)
        handleIncomingConversationMessageUpdate(message)
        if (message.body.type === "revoked") {
          void refreshConversations().catch(() => undefined)
        }
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [handleIncomingConversationMessageUpdate, refreshConversations, subscribeRealtimeEvent])

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.reactions_updated", (payload) => {
      try {
        handleIncomingMessageReactionsUpdate(normalizeMessageReactionsUpdatedEventPayload(payload))
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [handleIncomingMessageReactionsUpdate, subscribeRealtimeEvent])

  React.useEffect(() => {
    return subscribeRealtimeEvent("message.choice_updated", (payload) => {
      try {
        handleIncomingMessageChoiceUpdate?.(normalizeMessageChoiceUpdatedEventPayload(payload))
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [handleIncomingMessageChoiceUpdate, subscribeRealtimeEvent])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.removed", (payload) => {
      try {
        const event = normalizeConversationRemovedEventPayload(payload)
        removeConversation(event.conversationId)
        if (activeConversationId === event.conversationId) {
          navigate("/chat", { replace: true })
        }
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [activeConversationId, navigate, removeConversation, subscribeRealtimeEvent])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.restored", (payload) => {
      try {
        normalizeConversationRemovedEventPayload(payload)
        void refreshConversations().catch(() => undefined)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [refreshConversations, subscribeRealtimeEvent])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.mute_updated", (payload) => {
      try {
        const event = normalizeConversationMuteUpdatedEventPayload(payload)
        updateConversationMuted(event.conversationId, event.muted)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [subscribeRealtimeEvent, updateConversationMuted])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.pin_updated", (payload) => {
      try {
        const event = normalizeConversationPinUpdatedEventPayload(payload)
        updateConversationPinned(event.conversationId, event.pinned)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [subscribeRealtimeEvent, updateConversationPinned])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.member_mentioned", (payload) => {
      try {
        const event = normalizeConversationMemberMentionedEventPayload(payload)
        updateConversationLastMentionedSeq(event.conversationId, event.lastMentionedSeq)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [subscribeRealtimeEvent, updateConversationLastMentionedSeq])

  React.useEffect(() => {
    return subscribeRealtimeEvent("conversation.member_choice_received", (payload) => {
      try {
        const event = normalizeConversationMemberChoiceReceivedEventPayload(payload)
        updateConversationLastChoiceSeq?.(event.conversationId, event.lastChoiceSeq)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    })
  }, [subscribeRealtimeEvent, updateConversationLastChoiceSeq])

  React.useEffect(() => {
    const handleTopicEvent = (payload: unknown) => {
      try {
        const event = normalizeTopicEventPayload(payload)
        updateMessageTopic?.(event.parentConversationId, event.sourceMessageId, {
          archived: event.archived,
          conversationId: event.conversationId,
        })
        void refreshConversations().catch(() => undefined)
      } catch {
        recordRealtimeParseFailure()
        // Ignore malformed realtime events. The websocket remains usable.
      }
    }
    const unsubscribers = [
      subscribeRealtimeEvent("topic.created", handleTopicEvent),
      subscribeRealtimeEvent("topic.participated", handleTopicEvent),
      subscribeRealtimeEvent("topic.archived", handleTopicEvent),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [refreshConversations, subscribeRealtimeEvent, updateMessageTopic])

  React.useEffect(() => {
    const wasReady = previousRealtimeReadyRef.current
    previousRealtimeReadyRef.current = realtimeReady

    if (!realtimeReady || wasReady) {
      return
    }

    if (hasSeenRealtimeReadyRef.current) recoverAfterRealtimeReady()
    hasSeenRealtimeReadyRef.current = true
    syncLoadedConversationMessages()
  }, [realtimeReady, recoverAfterRealtimeReady, syncLoadedConversationMessages])

  return null
}
