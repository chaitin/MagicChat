import * as React from "react"
import { useLocale } from "@/components/locale-provider"
import { ArrowDown, LoaderCircle, MessageCircle } from "lucide-react"
import { type ClientConversation } from "@/lib/client-data-api"
import { type MentionLabelResolver } from "@/lib/message-mentions"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { MessageBubble, SystemMessageBadge } from "@/components/conversation/conversation-message"
import { ConversationStatusIndicator } from "@/components/conversation/conversation-status-indicator"
import { formatConversationMessageTime } from "@/lib/conversation-message-presenter"
import { conversationMessageRetentionLimit } from "@/lib/client-data-state"
import type {
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelMessageSelection,
} from "@/lib/conversation-panel-types"

export const ConversationPanelHistory = React.memo(function ConversationPanelHistory({
  canReply = true,
  conversation,
  currentUserId,
  error,
  focus = null,
  historyMode = false,
  loading,
  loadingAfter = false,
  loadingBefore,
  header,
  mentionLabelResolver,
  messages,
  messageSelection,
  onCompactMessages = noop,
  onConsumeFocus,
  onRegisterMessageView = noopRegistration,
  onForwardMessage,
  onCreateTopic,
  onLoadAfterMessages,
  onLoadBeforeMessages,
  onRetry,
  onStartMessageSelection,
  onInsertMention,
  onOpenTopic,
  onReeditRevokedMessage,
  onReplyToMessage,
  onReturnToLatestMessages,
  onRevokeMessage,
  onRespondToChoice,
  onSetMessageReaction,
  onToggleMessageSelection,
  pendingLatestMessageCount: externalPendingLatestMessageCount = 0,
  status,
}: {
  canReply?: boolean
  conversation: ClientConversation
  currentUserId: string
  error: string | null
  focus?: { messageId: string; requestKey: number } | null
  historyMode?: boolean
  loading: boolean
  loadingAfter?: boolean
  loadingBefore: boolean
  header?: React.ReactNode
  mentionLabelResolver: MentionLabelResolver
  messages: ConversationPanelMessage[]
  messageSelection?: ConversationPanelMessageSelection
  onCompactMessages?: () => void
  onConsumeFocus?: (focus: { messageId: string; requestKey: number }) => void
  onRegisterMessageView?: (conversationId: string) => () => void
  onForwardMessage?: (message: ConversationPanelMessage) => void
  onCreateTopic?: (message: ConversationPanelMessage) => void
  onLoadAfterMessages?: () => void
  onLoadBeforeMessages: () => void
  onRetry?: () => void
  onStartMessageSelection?: (message: ConversationPanelMessage) => void
  onInsertMention: (target: ConversationPanelMentionTarget) => void
  onOpenTopic?: (conversationId: string) => void
  onReeditRevokedMessage?: (message: ConversationPanelMessage) => void
  onReplyToMessage: (message: ConversationPanelMessage) => void
  onReturnToLatestMessages?: () => void
  onRevokeMessage?: (message: ConversationPanelMessage) => void
  onRespondToChoice?: (message: ConversationPanelMessage, optionIds: string[]) => Promise<void>
  onSetMessageReaction?: (
    message: ConversationPanelMessage,
    text: string,
    reacted: boolean,
  ) => Promise<void>
  onToggleMessageSelection?: (message: ConversationPanelMessage) => void
  pendingLatestMessageCount?: number
  status?: string
}) {
  const { t } = useLocale()
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentResizeObserverRef = React.useRef<ResizeObserver | null>(null)
  const nearBottomRef = React.useRef(true)
  const previousConversationIdRef = React.useRef<string | null>(null)
  const previousHistoryModeRef = React.useRef(historyMode)
  const scrollToLatestPendingRef = React.useRef(false)
  const previousFirstMessageIdRef = React.useRef<string | null>(null)
  const previousLastMessageIdRef = React.useRef<string | null>(null)
  const previousMessagesLengthRef = React.useRef(0)
  const beforeLoadSnapshotRef = React.useRef<ScrollSnapshot | null>(null)
  const previousLoadingBeforeRef = React.useRef(loadingBefore)
  const historyLoadStartFirstMessageIdRef = React.useRef<string | null>(
    loadingBefore ? (messages[0]?.id ?? null) : null,
  )
  const lastHistoryLoadedAtRef = React.useRef(0)
  const [viewportNearBottom, setViewportNearBottom] = React.useState(true)
  const [pendingNewMessageCount, setPendingNewMessageCount] = React.useState(0)
  const highlightTimeoutRef = React.useRef<number | null>(null)
  const compactRef = React.useRef(onCompactMessages)

  React.useEffect(() => {
    compactRef.current = onCompactMessages
  }, [onCompactMessages])

  React.useEffect(
    () => onRegisterMessageView(conversation.id),
    [conversation.id, onRegisterMessageView],
  )

  React.useEffect(
    () => () => {
      compactRef.current()
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current)
      }
    },
    [],
  )

  React.useEffect(() => {
    const wasLoadingBefore = previousLoadingBeforeRef.current
    if (!wasLoadingBefore && loadingBefore) {
      historyLoadStartFirstMessageIdRef.current = messages[0]?.id ?? null
    } else if (wasLoadingBefore && !loadingBefore) {
      const firstMessageId = messages[0]?.id ?? null
      if (firstMessageId !== historyLoadStartFirstMessageIdRef.current) {
        lastHistoryLoadedAtRef.current = Date.now()
      }
      historyLoadStartFirstMessageIdRef.current = null
    }
    previousLoadingBeforeRef.current = loadingBefore
  }, [loadingBefore, messages])

  React.useEffect(() => {
    if (
      messages.length <= conversationMessageRetentionLimit ||
      historyMode ||
      !viewportNearBottom ||
      loadingBefore ||
      messageSelection?.active
    ) {
      return
    }

    const remainingProtectionMs = Math.max(
      lastHistoryLoadedAtRef.current + historyRetentionMs - Date.now(),
      0,
    )
    if (remainingProtectionMs === 0) {
      onCompactMessages()
      return
    }

    const timeout = window.setTimeout(() => {
      if (nearBottomRef.current) {
        compactRef.current()
      }
    }, remainingProtectionMs)
    return () => window.clearTimeout(timeout)
  }, [
    historyMode,
    loadingBefore,
    messageSelection?.active,
    messages.length,
    onCompactMessages,
    viewportNearBottom,
  ])

  const setHistoryContentRef = React.useCallback(
    (content: HTMLDivElement | null) => {
      contentResizeObserverRef.current?.disconnect()
      contentResizeObserverRef.current = null

      if (!content) {
        return
      }

      const observer = new ResizeObserver(() => {
        const viewport = viewportRef.current
        if (!viewport || historyMode || !nearBottomRef.current) {
          return
        }

        scrollToBottom(viewport)
      })
      observer.observe(content)
      contentResizeObserverRef.current = observer
    },
    [historyMode],
  )

  React.useEffect(() => {
    if (!historyMode || !focus) return
    const viewport = viewportRef.current
    if (!viewport) return
    const frame = window.requestAnimationFrame(() => {
      const element = findMessageElement(viewport, focus.messageId)
      if (!element) return
      element.scrollIntoView({ block: "center" })
      onConsumeFocus?.(focus)
      element.classList.add(...historyHighlightClasses)
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current)
      }
      highlightTimeoutRef.current = window.setTimeout(() => {
        element.classList.remove(...historyHighlightClasses)
        highlightTimeoutRef.current = null
      }, historyHighlightDurationMs)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focus, historyMode, messages, onConsumeFocus])

  React.useLayoutEffect(() => {
    const returnedToLatest = previousHistoryModeRef.current && !historyMode
    previousHistoryModeRef.current = historyMode
    if (returnedToLatest) {
      scrollToLatestPendingRef.current = true
    }

    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const firstMessageId = messages[0]?.id ?? null
    const lastMessageId = messages[messages.length - 1]?.id ?? null
    const previousConversationId = previousConversationIdRef.current
    const previousFirstMessageId = previousFirstMessageIdRef.current
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousMessagesLength = previousMessagesLengthRef.current
    const changedConversation = previousConversationId !== conversation.id
    const shouldScrollToLatest = !historyMode && scrollToLatestPendingRef.current

    if (changedConversation || shouldScrollToLatest) {
      if (!historyMode) scrollToBottom(viewport)
      nearBottomRef.current = !historyMode
      setViewportNearBottom(!historyMode)
      beforeLoadSnapshotRef.current = null
      setPendingNewMessageCount(0)
      if (shouldScrollToLatest) {
        scrollToLatestPendingRef.current = false
        const frame = window.requestAnimationFrame(() => scrollToBottom(viewport))
        previousConversationIdRef.current = conversation.id
        previousFirstMessageIdRef.current = firstMessageId
        previousLastMessageIdRef.current = lastMessageId
        previousMessagesLengthRef.current = messages.length
        return () => window.cancelAnimationFrame(frame)
      }
    } else {
      if (
        firstMessageId &&
        previousFirstMessageId &&
        firstMessageId !== previousFirstMessageId &&
        beforeLoadSnapshotRef.current
      ) {
        restoreScrollPositionAfterPrepend(viewport, beforeLoadSnapshotRef.current)
        const nearBottom = isNearBottom(viewport)
        nearBottomRef.current = nearBottom
        setViewportNearBottom(nearBottom)
        beforeLoadSnapshotRef.current = null
      }

      if (
        !historyMode &&
        lastMessageId &&
        previousLastMessageId !== lastMessageId &&
        messages.length >= previousMessagesLength
      ) {
        const appendedMessages = getAppendedMessages(
          messages,
          previousLastMessageId,
          previousMessagesLength,
        )
        const shouldFollowLatest =
          nearBottomRef.current || appendedMessages.some((message) => message.role === "me")

        if (shouldFollowLatest) {
          scrollToBottom(viewport)
          nearBottomRef.current = true
          setPendingNewMessageCount(0)
        } else {
          const incomingMessageCount = appendedMessages.filter(
            (message) => message.role !== "me",
          ).length
          if (incomingMessageCount > 0) {
            setPendingNewMessageCount((currentCount) => currentCount + incomingMessageCount)
          }
        }
      }
    }

    previousConversationIdRef.current = conversation.id
    previousFirstMessageIdRef.current = firstMessageId
    previousLastMessageIdRef.current = lastMessageId
    previousMessagesLengthRef.current = messages.length
  }, [conversation.id, historyMode, loading, messages])

  function handleViewportScroll(event: React.UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget
    const nearBottom = isNearBottom(viewport)

    nearBottomRef.current = nearBottom
    setViewportNearBottom(nearBottom)
    if (nearBottom && !historyMode) {
      setPendingNewMessageCount((currentCount) => (currentCount === 0 ? currentCount : 0))
    }

    if (loadingBefore) {
      const snapshot = beforeLoadSnapshotRef.current
      if (snapshot) {
        beforeLoadSnapshotRef.current = createScrollSnapshot(viewport, snapshot.anchorMessageId)
      }
      return
    }

    if (viewport.scrollTop <= 80) {
      beforeLoadSnapshotRef.current = createScrollSnapshot(viewport, messages[0]?.id ?? null)
      onLoadBeforeMessages()
    }
    if (
      historyMode &&
      !loadingAfter &&
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 80
    ) {
      onLoadAfterMessages?.()
    }
  }

  function handleJumpToLatest() {
    if (historyMode) {
      onReturnToLatestMessages?.()
      return
    }
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    scrollToBottom(viewport)
    nearBottomRef.current = true
    setViewportNearBottom(true)
    setPendingNewMessageCount(0)
  }

  const handleMessageContentSizeChange = React.useCallback((messageId: string) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const shouldFollowLatest = nearBottomRef.current
    const snapshot = createContentSizeSnapshot(viewport, messageId)
    window.requestAnimationFrame(() => {
      const currentViewport = viewportRef.current
      if (!currentViewport) return
      if (shouldFollowLatest) {
        scrollToBottom(currentViewport)
      } else {
        restoreScrollPositionAfterPrepend(currentViewport, snapshot)
      }
    })
  }, [])

  function handleHistoryContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-message-action-trigger]")) {
      return
    }

    event.preventDefault()
  }

  if (loading && !header) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-muted/10 text-sm text-muted-foreground"
        data-testid="conversation-history-loading"
      >
        <LoaderCircle className="size-4 animate-spin" />
        <span>{t("history.loading")}</span>
      </div>
    )
  }

  if (error && messages.length === 0 && !header) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/10 px-6 text-center text-sm text-muted-foreground"
        data-testid="conversation-history-error"
      >
        <p>{error}</p>
        {onRetry && (
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            {t("history.retry")}
          </Button>
        )}
      </div>
    )
  }

  if (messages.length === 0 && header) {
    return (
      <div className="relative min-h-0 flex-1">
        <ScrollArea
          className="size-full bg-muted/10"
          data-testid="conversation-panel-history"
          viewportProps={{
            className: "[&>div]:block! [&>div]:w-full! [&>div]:min-w-0!",
            onContextMenu: handleHistoryContextMenu,
          }}
          viewportRef={viewportRef}
        >
          <div
            ref={setHistoryContentRef}
            className="flex w-full flex-col gap-5 px-5 py-6"
            data-testid="conversation-history-content"
          >
            {header}
            {loading && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" />
                <span>{t("history.loadingTopics")}</span>
              </div>
            )}
            {error && (
              <div className="grid justify-items-center gap-2 text-center text-xs text-muted-foreground">
                <p>{error}</p>
                {onRetry && (
                  <Button onClick={onRetry} size="sm" type="button" variant="outline">
                    {t("history.retry")}
                  </Button>
                )}
              </div>
            )}
            {status && <ConversationStatusBubble status={status} />}
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-muted/10">
        <Empty className="min-h-0 flex-1 rounded-none" data-testid="conversation-history-empty">
          <EmptyMedia>
            <MessageCircle className="size-14 text-muted-foreground/25" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t("history.empty")}</EmptyTitle>
            <EmptyDescription>{t("history.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {status && (
          <div className="px-5 pb-6">
            <ConversationStatusBubble status={status} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea
        className="size-full bg-muted/10"
        data-testid="conversation-panel-history"
        viewportProps={{
          className: "[&>div]:block! [&>div]:w-full! [&>div]:min-w-0!",
          onContextMenu: handleHistoryContextMenu,
          onScroll: handleViewportScroll,
        }}
        viewportRef={viewportRef}
      >
        <div
          ref={setHistoryContentRef}
          className="flex w-full flex-col gap-5 px-5 py-6"
          data-testid="conversation-history-content"
        >
          {header}
          {loadingBefore && (
            <div
              className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
              data-testid="conversation-history-loading-before"
            >
              <LoaderCircle className="size-3.5 animate-spin" />
              <span>{t("history.loadingEarlier")}</span>
            </div>
          )}
          {messages.map((message, index) => (
            <React.Fragment key={message.id}>
              {shouldShowMessageTimeMarker(messages[index - 1], message) && (
                <div className="text-center text-xs text-muted-foreground" data-message-time-marker>
                  {formatConversationMessageTime(message.createdAt)}
                </div>
              )}
              {message.role === "system" ? (
                <SystemMessageBadge
                  currentUserId={currentUserId}
                  mentionLabelResolver={mentionLabelResolver}
                  message={message}
                />
              ) : (
                <MessageBubble
                  canReply={canReply}
                  message={message}
                  conversation={conversation}
                  currentUserId={currentUserId}
                  mentionLabelResolver={mentionLabelResolver}
                  onForward={isMessageAvailable(message) ? onForwardMessage : undefined}
                  onCreateTopic={onCreateTopic}
                  onContentSizeChange={handleMessageContentSizeChange}
                  onInsertMention={onInsertMention}
                  onOpenTopic={onOpenTopic}
                  onReeditRevoked={onReeditRevokedMessage}
                  onMultiSelect={isMessageAvailable(message) ? onStartMessageSelection : undefined}
                  onReply={onReplyToMessage}
                  onRevoke={onRevokeMessage}
                  onRespondToChoice={onRespondToChoice}
                  onSetReaction={onSetMessageReaction}
                  onToggleSelected={onToggleMessageSelection}
                  selectable={isMessageAvailable(message)}
                  selected={messageSelection?.selectedMessageIds.has(message.id)}
                  selectionMode={messageSelection?.active}
                />
              )}
            </React.Fragment>
          ))}
          {status && <ConversationStatusBubble status={status} />}
          {loadingAfter && (
            <div
              className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
              data-testid="conversation-history-loading-after"
            >
              <LoaderCircle className="size-3.5 animate-spin" />
              <span>{t("history.loadingNewer")}</span>
            </div>
          )}
        </div>
      </ScrollArea>
      {(historyMode || pendingNewMessageCount > 0) && (
        <Button
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={handleJumpToLatest}
          size="sm"
          type="button"
          variant="secondary"
        >
          <ArrowDown className="size-4" />
          {historyMode
            ? externalPendingLatestMessageCount > 0
              ? t("history.backToLatestNew", { count: externalPendingLatestMessageCount })
              : t("history.backToLatest")
            : t("history.newMessages", { count: pendingNewMessageCount })}
        </Button>
      )}
    </div>
  )
})

function isMessageAvailable(message: ConversationPanelMessage) {
  return (
    message.body.type !== "choice" &&
    message.body.type !== "revoked" &&
    message.body.type !== "unsupported"
  )
}

function ConversationStatusBubble({ status }: { status: string }) {
  return (
    <div
      className="w-fit max-w-[75%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground"
      data-testid="conversation-status-bubble"
    >
      <ConversationStatusIndicator status={status} />
    </div>
  )
}

const messageTimeMarkerThresholdMs = 60 * 60 * 1000
const historyRetentionMs = 3 * 60 * 1000
const historyHighlightDurationMs = 2_000
const historyHighlightClasses = ["rounded-md", "ring-2", "ring-primary/70"]

function noop() {}

function noopRegistration() {
  return noop
}

function shouldShowMessageTimeMarker(
  previousMessage: ConversationPanelMessage | undefined,
  message: ConversationPanelMessage,
) {
  if (!previousMessage) {
    return false
  }

  const previousTime = new Date(previousMessage.createdAt).getTime()
  const messageTime = new Date(message.createdAt).getTime()
  if (Number.isNaN(previousTime) || Number.isNaN(messageTime)) {
    return false
  }

  return messageTime - previousTime > messageTimeMarkerThresholdMs
}

function scrollToBottom(viewport: HTMLDivElement) {
  viewport.scrollTop = viewport.scrollHeight
}

function isNearBottom(viewport: HTMLDivElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 80
}

type ScrollSnapshot = {
  anchorMessageId: string | null
  anchorTop: number | null
  scrollHeight: number
  scrollTop: number
}

function createScrollSnapshot(
  viewport: HTMLDivElement,
  anchorMessageId: string | null,
): ScrollSnapshot {
  return {
    anchorMessageId,
    anchorTop: getMessageTop(viewport, anchorMessageId),
    scrollHeight: viewport.scrollHeight,
    scrollTop: viewport.scrollTop,
  }
}

function createContentSizeSnapshot(viewport: HTMLDivElement, messageId: string): ScrollSnapshot {
  const anchor = findFirstVisibleMessage(viewport)
  return createScrollSnapshot(viewport, anchor?.dataset.conversationMessageId ?? messageId)
}

function restoreScrollPositionAfterPrepend(viewport: HTMLDivElement, snapshot: ScrollSnapshot) {
  const nextAnchorTop = getMessageTop(viewport, snapshot.anchorMessageId)
  if (snapshot.anchorTop !== null && nextAnchorTop !== null) {
    viewport.scrollTop += nextAnchorTop - snapshot.anchorTop
    return
  }

  viewport.scrollTop = snapshot.scrollTop + (viewport.scrollHeight - snapshot.scrollHeight)
}

function getMessageTop(viewport: HTMLDivElement, messageId: string | null): number | null {
  if (!messageId) {
    return null
  }

  const messageElement = findMessageElement(viewport, messageId)

  return messageElement?.getBoundingClientRect().top ?? null
}

function findFirstVisibleMessage(viewport: HTMLDivElement): HTMLElement | null {
  const viewportRect = viewport.getBoundingClientRect()
  const viewportTop = viewportRect.top
  const viewportBottom =
    viewportRect.bottom > viewportTop ? viewportRect.bottom : viewportTop + viewport.clientHeight

  return (
    Array.from(viewport.querySelectorAll<HTMLElement>("[data-conversation-message-id]")).find(
      (element) => {
        const rect = element.getBoundingClientRect()
        const messageBottom = rect.bottom > rect.top ? rect.bottom : rect.top + 1
        return messageBottom > viewportTop && rect.top < viewportBottom
      },
    ) ?? null
  )
}

function findMessageElement(viewport: HTMLDivElement, messageId: string | null) {
  if (!messageId) return null
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-conversation-message-id]")).find(
    (element) => element.dataset.conversationMessageId === messageId,
  )
}

function getAppendedMessages(
  messages: ConversationPanelMessage[],
  previousLastMessageId: string | null,
  previousMessagesLength: number,
) {
  const previousLastMessageIndex = previousLastMessageId
    ? messages.findIndex((message) => message.id === previousLastMessageId)
    : -1

  if (previousLastMessageIndex >= 0) {
    return messages.slice(previousLastMessageIndex + 1)
  }

  return messages.slice(previousMessagesLength)
}
