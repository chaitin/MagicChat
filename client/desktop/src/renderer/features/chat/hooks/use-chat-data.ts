import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { DesktopConversation, DesktopMessage } from "../../../../shared/account-data"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import type { MentionTarget } from "@/lib/message-mentions"

export function useChatData({
  targetId,
  userId,
  userName,
}: {
  targetId: string
  userId: string
  userName: string
}) {
  const { showToast } = useAnimatedToast()
  const [conversations, setConversations] = useState<DesktopConversation[]>([])
  const [messages, setMessages] = useState<DesktopMessage[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [transientConversation, setTransientConversation] = useState<DesktopConversation | null>(
    null,
  )
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingBeforeMessages, setLoadingBeforeMessages] = useState(false)
  const [hasMoreBeforeMessages, setHasMoreBeforeMessages] = useState(false)
  const [conversationRevision, setConversationRevision] = useState(0)
  const [messageRevision, setMessageRevision] = useState(0)
  const [contactRevision, setContactRevision] = useState(0)
  const [mentionLabels, setMentionLabels] = useState<Map<string, string>>(new Map())
  const [pendingReactionKeys, setPendingReactionKeys] = useState<Set<string>>(new Set())
  const [newMessageCount, setNewMessageCount] = useState(0)
  const realtimeRevisionRef = useRef(0)
  const loadingBeforeRef = useRef(false)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const scrollToBottomRef = useRef(true)
  const isAtBottomRef = useRef(true)
  const messagesRef = useRef(messages)
  const selectedIdRef = useRef(selectedId)
  const loadedConversationIdRef = useRef<string | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  selectedIdRef.current = selectedId
  messagesRef.current = messages

  const selected = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedId) ??
      (transientConversation?.id === selectedId ? transientConversation : null),
    [conversations, selectedId, transientConversation],
  )

  const setSelectedId = useCallback((conversationId: string) => {
    setTransientConversation(null)
    setSelectedIdState(conversationId)
  }, [])

  const openTopicConversation = useCallback(
    (conversationId: string) => {
      if (!conversations.some((conversation) => conversation.id === conversationId)) {
        const parent = conversations.find(
          (conversation) => conversation.id === selectedIdRef.current,
        )
        setTransientConversation({
          id: conversationId,
          type: "topic",
          name: "话题",
          memberCount: parent?.memberCount ?? 0,
          avatarType: parent?.avatarType ?? "group",
          avatarId: parent?.avatarId ?? "",
          createdAt: "",
          lastMessageAt: null,
          lastMessageSummary: "",
          pinned: false,
          notificationMuted: false,
          isBuiltinAssistant: false,
          unreadCount: 0,
        })
      } else {
        setTransientConversation(null)
      }
      setSelectedIdState(conversationId)
    },
    [conversations],
  )

  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.accountData.onChanged((event) => {
      if (event.targetId !== targetId || event.revision <= realtimeRevisionRef.current) return
      realtimeRevisionRef.current = event.revision
      if (event.domains.includes("conversations")) {
        setConversationRevision((revision) => revision + 1)
      }
      if (event.domains.includes("contacts")) {
        setContactRevision((revision) => revision + 1)
      }
      if (
        event.domains.includes("messages") &&
        selectedId &&
        (event.conversationIds.length === 0 || event.conversationIds.includes(selectedId))
      ) {
        setMessageRevision((revision) => revision + 1)
      }
    })
  }, [selectedId, targetId])

  useEffect(() => {
    let cancelled = false
    async function loadConversations() {
      if (!window.desktop || !targetId) return
      try {
        const result = await window.desktop.accountData.listConversations(targetId)
        if (cancelled) return
        if (result.ok) setConversations(result.data)
        else
          showToast({ status: "error", title: "无法读取对话", description: result.error.message })
      } catch {
        if (!cancelled) showToast({ status: "error", title: "无法读取对话" })
      } finally {
        if (!cancelled) setLoadingConversations(false)
      }
    }
    void loadConversations()
    return () => {
      cancelled = true
    }
  }, [conversationRevision, showToast, targetId])

  useEffect(() => {
    if (!window.desktop || !targetId) return
    let cancelled = false
    void window.desktop.accountData.getContacts(targetId).then((result) => {
      if (cancelled || !result.ok) return
      const labels = new Map<string, string>([[`user:${userId.toLowerCase()}`, userName]])
      for (const user of result.data.users) {
        labels.set(`user:${user.id.toLowerCase()}`, user.nickname || user.name)
      }
      for (const app of result.data.apps) {
        labels.set(`app:${app.id.toLowerCase()}`, app.name)
      }
      setMentionLabels(labels)
    })
    return () => {
      cancelled = true
    }
  }, [contactRevision, targetId, userId, userName])

  const resolveMentionLabel = useCallback(
    (target: MentionTarget) =>
      target.type === "all"
        ? undefined
        : mentionLabels.get(`${target.type}:${target.id.toLowerCase()}`),
    [mentionLabels],
  )

  const setMessageReaction = useCallback(
    async (message: DesktopMessage, text: string, reacted: boolean) => {
      const key = `${message.id}\0${text}`
      if (pendingReactionKeys.has(key) || !window.desktop) return
      setPendingReactionKeys((current) => new Set(current).add(key))
      try {
        const result = await window.desktop.accountData.setMessageReaction({
          targetId,
          conversationId: message.conversationId,
          messageId: message.id,
          text,
          reacted,
        })
        if (!result.ok) {
          showToast({
            status: "error",
            title: "更新表情失败",
            description: result.error.message,
          })
          return
        }
        setMessages(result.data)
      } catch {
        showToast({ status: "error", title: "更新表情失败" })
      } finally {
        setPendingReactionKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    },
    [pendingReactionKeys, showToast, targetId],
  )

  const setConversationPinned = useCallback(
    async (conversationId: string, pinned: boolean) => {
      if (!window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.accountData.setConversationPinned({
        targetId,
        conversationId,
        pinned,
      })
      if (!result.ok) throw new Error(result.error.message)
      setConversations(result.data)
    },
    [targetId],
  )

  const setConversationMuted = useCallback(
    async (conversationId: string, muted: boolean) => {
      if (!window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.accountData.setConversationMuted({
        targetId,
        conversationId,
        muted,
      })
      if (!result.ok) throw new Error(result.error.message)
      setConversations(result.data)
    },
    [targetId],
  )

  const dismissConversation = useCallback(
    async (conversationId: string) => {
      if (!window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.accountData.dismissConversation({
        targetId,
        conversationId,
      })
      if (!result.ok) throw new Error(result.error.message)
      setConversations(result.data)
      if (selectedIdRef.current === conversationId) {
        setSelectedIdState(null)
        setTransientConversation(null)
        setMessages([])
      }
    },
    [targetId],
  )

  const submitChoiceResponse = useCallback(
    async (message: DesktopMessage, optionIds: string[]) => {
      if (!window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.accountData.submitChoiceResponse({
        targetId,
        conversationId: message.conversationId,
        messageId: message.id,
        optionIds,
      })
      if (!result.ok) throw new Error(result.error.message)
      if (selectedIdRef.current === message.conversationId) setMessages(result.data)
    },
    [targetId],
  )

  const applySentMessages = useCallback(
    (conversationId: string, nextMessages: DesktopMessage[]) => {
      if (selectedIdRef.current !== conversationId) return
      scrollToBottomRef.current = true
      setMessages(nextMessages)
    },
    [],
  )

  const sendTextMessage = useCallback(
    (content: string, bodyType: "text" | "markdown" | "link") => {
      const conversationId = selectedIdRef.current
      if (!conversationId || !window.desktop) return
      scrollToBottomRef.current = true
      void window.desktop.accountData
        .sendTextMessage({ targetId, conversationId, content, bodyType })
        .then((result) => {
          if (selectedIdRef.current !== conversationId) return
          if (result.ok) {
            setMessages(result.data)
            return
          }
          showToast({
            status: "error",
            title: "发送消息失败",
            description: result.error.message,
          })
        })
        .catch(() => {
          if (selectedIdRef.current === conversationId) {
            showToast({ status: "error", title: "发送消息失败" })
          }
        })
    },
    [showToast, targetId],
  )

  const retryMessage = useCallback(
    (message: DesktopMessage) => {
      if (!window.desktop || !message.clientMessageId) return
      const conversationId = message.conversationId
      void window.desktop.accountData
        .retryMessage({
          targetId,
          conversationId,
          clientMessageId: message.clientMessageId,
        })
        .then((result) => {
          if (selectedIdRef.current !== conversationId) return
          if (result.ok) {
            setMessages(result.data)
            return
          }
          showToast({
            status: "error",
            title: "重试发送失败",
            description: result.error.message,
          })
        })
        .catch(() => {
          if (selectedIdRef.current === conversationId) {
            showToast({ status: "error", title: "重试发送失败" })
          }
        })
    },
    [showToast, targetId],
  )

  useEffect(() => {
    if (!selectedId || !window.desktop) {
      loadedConversationIdRef.current = null
      setMessages([])
      return
    }
    let cancelled = false
    const switchingConversation = loadedConversationIdRef.current !== selectedId
    loadedConversationIdRef.current = selectedId
    if (switchingConversation) {
      scrollToBottomRef.current = true
      isAtBottomRef.current = true
      setNewMessageCount(0)
      prependSnapshotRef.current = null
      setHasMoreBeforeMessages(false)
      setLoadingMessages(true)
    }
    void window.desktop.accountData
      .listMessages({ targetId, conversationId: selectedId })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          if (!switchingConversation) {
            const previous = messagesRef.current
            const latestSeq = previous.at(-1)?.seq ?? 0
            const receivedCount = result.data.filter(
              (message) => message.seq > latestSeq && !message.isMine,
            ).length
            if (receivedCount > 0) {
              if (isAtBottomRef.current) scrollToBottomRef.current = true
              else setNewMessageCount((count) => count + receivedCount)
            }
          }
          setMessages(result.data)
          setHasMoreBeforeMessages(result.data.length > 0 && result.data[0].seq > 1)
        } else {
          setMessages([])
          showToast({
            status: "error",
            title: "无法读取聊天记录",
            description: result.error.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
          showToast({ status: "error", title: "无法读取聊天记录" })
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false)
      })
    return () => {
      cancelled = true
    }
  }, [messageRevision, selectedId, showToast, targetId])

  const updateHistoryScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 48
    isAtBottomRef.current = atBottom
    if (atBottom) setNewMessageCount(0)
  }, [])

  const scrollToLatestMessage = useCallback(() => {
    const viewport = historyRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    isAtBottomRef.current = true
    scrollToBottomRef.current = false
    setNewMessageCount(0)
  }, [])

  useEffect(() => {
    const viewport = historyRef.current
    const content = viewport?.firstElementChild
    if (!viewport || !content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current || scrollToBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [selectedId])

  useLayoutEffect(() => {
    if (!selected || loadingMessages) return
    const viewport = historyRef.current
    if (!viewport) return
    const snapshot = prependSnapshotRef.current
    if (snapshot) {
      viewport.scrollTop = snapshot.scrollTop + viewport.scrollHeight - snapshot.scrollHeight
      prependSnapshotRef.current = null
      return
    }
    if (!scrollToBottomRef.current) return
    viewport.scrollTop = viewport.scrollHeight
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
      scrollToBottomRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loadingMessages, messages, selected])

  const loadBeforeMessages = useCallback(async () => {
    if (
      !window.desktop ||
      !selectedId ||
      messages.length === 0 ||
      !hasMoreBeforeMessages ||
      loadingBeforeRef.current
    ) {
      return
    }
    const viewport = historyRef.current
    if (!viewport) return
    const conversationId = selectedId
    loadingBeforeRef.current = true
    setLoadingBeforeMessages(true)
    prependSnapshotRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    }
    try {
      const result = await window.desktop.accountData.loadBeforeMessages({
        targetId,
        conversationId,
        beforeSeq: messages[0].seq,
      })
      if (selectedIdRef.current !== conversationId) return
      if (!result.ok) {
        prependSnapshotRef.current = null
        showToast({
          status: "error",
          title: "无法加载更早消息",
          description: result.error.message,
        })
        return
      }
      setMessages(result.data.messages)
      setHasMoreBeforeMessages(result.data.hasMoreBefore)
    } catch {
      if (selectedIdRef.current === conversationId) {
        prependSnapshotRef.current = null
        showToast({ status: "error", title: "无法加载更早消息" })
      }
    } finally {
      loadingBeforeRef.current = false
      if (selectedIdRef.current === conversationId) setLoadingBeforeMessages(false)
    }
  }, [hasMoreBeforeMessages, messages, selectedId, showToast, targetId])

  return {
    conversations,
    messages,
    selected,
    selectedId,
    loadingConversations,
    loadingMessages,
    loadingBeforeMessages,
    pendingReactionKeys,
    newMessageCount,
    historyRef,
    setSelectedId,
    openTopicConversation,
    updateHistoryScrollPosition,
    scrollToLatestMessage,
    resolveMentionLabel,
    setMessageReaction,
    setConversationPinned,
    setConversationMuted,
    dismissConversation,
    submitChoiceResponse,
    applySentMessages,
    sendTextMessage,
    retryMessage,
    loadBeforeMessages,
  }
}
