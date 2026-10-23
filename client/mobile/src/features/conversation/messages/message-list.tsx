import { ArrowDown } from "lucide-react-native"
import type { OptimisticMessage } from "@/features/conversation/optimistic-message-model"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native"
import { Text } from "@/components/mi-sans-text"
import { measureMobilePerf, recordMobilePerf } from "@/diagnostics/mobile-perf"

import { ContentState } from "@/components/feedback/content-state"
import { AppButton } from "@/components/forms/app-button"
import { MessageBubble } from "@/features/conversation/messages/message-bubble"
import { useMessageHistoryPagination } from "./use-message-history-pagination"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type {
  MessageMentionLabelResolver,
  PresentedMessage,
} from "@/domain/messages/message-presenter"
import {
  formatMessageTimeMarker,
  shouldShowMessageTimeMarker,
} from "@/domain/messages/message-presenter"
import type { ServerTarget } from "@/core/server-target"
import type { ResourceLoadState } from "@/data/resources"
import { XGUIButton, XGUILoadmore, useXGUITheme } from "@/xgui"

export function MessageList({
  canAddReaction,
  canCreateTopic,
  canRespondToChoice,
  conversationId,
  currentUserId,
  error,
  hasOlder,
  olderCursor,
  olderError,
  initialMessageId,
  focusRequestKey = 0,
  isFetchingOlder,
  isLoading,
  messages,
  onAvatarPress,
  onAvatarLongPress,
  onContentTouch,
  onImagePress,
  onLoadOlder,
  onMessageLongPress,
  onLocateReplyMessage,
  onRetry,
  onRetryMessage,
  optimisticMessages,
  onResourceError,
  onResourcePress,
  onRespondChoice,
  onSetReaction,
  onVoiceResourcePress,
  onMentionPress,
  onOpenTopic,
  resolveMentionLabel,
  resourceStates,
  server,
  showChoiceResponseCounts,
}: {
  canAddReaction: boolean
  canCreateTopic: boolean
  canRespondToChoice: boolean
  conversationId: string
  currentUserId: string
  error: Error | null
  hasOlder: boolean
  olderCursor: number | undefined
  olderError: Error | null
  initialMessageId?: string
  focusRequestKey?: number
  isFetchingOlder: boolean
  isLoading: boolean
  messages: PresentedMessage[]
  optimisticMessages: OptimisticMessage[]
  onAvatarLongPress?: (sender: EntityReference) => void
  onAvatarPress: (sender: EntityReference) => void
  onContentTouch: () => void
  onImagePress: (fileId: string, messageId: string) => void
  onLoadOlder: () => void
  onMessageLongPress: (message: PresentedMessage) => void
  onLocateReplyMessage?: (message: PresentedMessage) => void
  onRetry: () => void
  onRetryMessage: (clientMessageId: string) => void
  onResourceError: (fileId: string) => void
  onResourcePress: (fileId: string) => void
  onRespondChoice?: (messageId: string, optionIds: string[]) => Promise<void>
  onSetReaction?: (
    messageId: string,
    text: string,
    reacted: boolean
  ) => Promise<void>
  onVoiceResourcePress: (fileId: string) => void
  onMentionPress: (target: EntityReference) => void
  onOpenTopic: (conversationId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  resourceStates: ReadonlyMap<string, ResourceLoadState>
  server: ServerTarget
  showChoiceResponseCounts: boolean
}) {
  const { colors } = useXGUITheme()
  const listStyle = useMemo(
    () => [styles.list, { backgroundColor: colors.background0 }],
    [colors.background0]
  )
  const listItems = useMemo(
    () => measureMobilePerf("conversation.build_items_ms", () => buildMessageListItems(messages)),
    [messages]
  )
  useEffect(() => {
    recordMobilePerf("conversation.list_commit")
  })
  const optimisticById = useMemo(
    () => new Map(optimisticMessages.map((item) => [item.message.id, item] as const)),
    [optimisticMessages]
  )
  const listRef = useRef<FlatList<MessageListItem>>(null)
  const nearBottomRef = useRef(true)
  const initializedMessagesRef = useRef(false)
  const previousConversationIdRef = useRef("")
  const previousNewestMessageIdRef = useRef<string | null>(null)
  const previousMessagesLengthRef = useRef(0)
  const pendingScrollRef = useRef<PendingScroll>(null)
  const focusedMessageIdRef = useRef("")
  const pendingFocusedMessageIdRef = useRef("")
  const targetScrollRetriesRef = useRef(0)
  const requestedTargetIndexRef = useRef(-1)
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const visibleMessageIdsRef = useRef(new Set<string>())
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [viewabilityConfig] = useState(() => ({ itemVisiblePercentThreshold: 50 }))
  const [highlightedMessageId, setHighlightedMessageId] = useState("")
  const completeMessageFocus = useCallback((messageId: string) => {
    pendingFocusedMessageIdRef.current = ""
    focusedMessageIdRef.current = messageId
    setHighlightedMessageId(messageId)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(""), 2_000)
  }, [])
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<MessageListItem>[] }) => {
      const visible = new Set<string>()
      for (const token of viewableItems) {
        if (token.isViewable && token.item.type === "message") visible.add(token.item.message.id)
      }
      visibleMessageIdsRef.current = visible
      const pendingMessageId = pendingFocusedMessageIdRef.current
      if (pendingMessageId && visible.has(pendingMessageId)) completeMessageFocus(pendingMessageId)
    },
    [completeMessageFocus]
  )
  const [pendingNewMessageCount, setPendingNewMessageCount] = useState(0)

  useEffect(() => {
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId
      previousNewestMessageIdRef.current = null
      previousMessagesLengthRef.current = 0
      initializedMessagesRef.current = false
      nearBottomRef.current = true
      pendingScrollRef.current = null
      focusedMessageIdRef.current = ""
      pendingFocusedMessageIdRef.current = ""
      targetScrollRetriesRef.current = 0
      clearTimeout(highlightTimerRef.current)
      setHighlightedMessageId("")
      setPendingNewMessageCount(0)
    }

    if (!initializedMessagesRef.current) {
      if (!isLoading) {
        initializedMessagesRef.current = true
        previousNewestMessageIdRef.current = messages[0]?.id ?? null
        previousMessagesLengthRef.current = messages.length
        if (messages.length > 0 && !initialMessageId) {
          scheduleScrollToLatest(listRef, pendingScrollRef, false)
        }
      }
      return
    }

    const newestMessageId = messages[0]?.id ?? null
    const previousNewestMessageId = previousNewestMessageIdRef.current
    if (newestMessageId && newestMessageId !== previousNewestMessageId) {
      const newMessages = getNewMessages(
        messages,
        previousNewestMessageId,
        previousMessagesLengthRef.current
      )

      if (newMessages.length > 0) {
        if (nearBottomRef.current) {
          scheduleScrollToLatest(listRef, pendingScrollRef, true)
          setPendingNewMessageCount(0)
        } else {
          setPendingNewMessageCount(
            (currentCount) => currentCount + newMessages.length
          )
        }
      }
    }

    previousNewestMessageIdRef.current = newestMessageId
    previousMessagesLengthRef.current = messages.length
  }, [conversationId, initialMessageId, isLoading, messages])

  useEffect(() => {
    focusedMessageIdRef.current = ""
    pendingFocusedMessageIdRef.current = ""
    requestedTargetIndexRef.current = -1
    clearTimeout(scrollRetryTimerRef.current)
    clearTimeout(highlightTimerRef.current)
    if (initialMessageId) {
      nearBottomRef.current = false
      pendingScrollRef.current = null
    }
  }, [initialMessageId, focusRequestKey])

  useEffect(() => {
    if (!initialMessageId || focusedMessageIdRef.current === initialMessageId) {
      return
    }
    const targetIndex = listItems.findIndex(
      (item) => item.type === "message" && item.message.id === initialMessageId
    )
    if (targetIndex < 0) return
    pendingFocusedMessageIdRef.current = initialMessageId
    requestedTargetIndexRef.current = targetIndex
    targetScrollRetriesRef.current = 0
    const frame = requestAnimationFrame(() => {
      if (pendingFocusedMessageIdRef.current !== initialMessageId) return
      listRef.current?.scrollToIndex({
        animated: false,
        index: targetIndex,
        viewPosition: 0.5,
      })
      if (visibleMessageIdsRef.current.has(initialMessageId)) completeMessageFocus(initialMessageId)
    })
    return () => cancelAnimationFrame(frame)
  }, [completeMessageFocus, focusRequestKey, initialMessageId, listItems])

  useEffect(
    () => () => {
      clearTimeout(highlightTimerRef.current)
      clearTimeout(scrollRetryTimerRef.current)
    },
    []
  )

  const { updateMetrics, onReachOlder, onRetryOlder } = useMessageHistoryPagination({
    conversationId,
    cursor: olderCursor,
    hasOlder,
    isLoading,
    isFetchingOlder,
    error: olderError,
    onLoadOlder,
  })

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateMetrics({
        contentHeight: event.nativeEvent.contentSize.height,
        viewportHeight: event.nativeEvent.layoutMeasurement.height,
        offset: event.nativeEvent.contentOffset.y,
      })
      const nearBottom = event.nativeEvent.contentOffset.y <= 80
      nearBottomRef.current = nearBottom

      if (nearBottom) {
        setPendingNewMessageCount((currentCount) =>
          currentCount === 0 ? currentCount : 0
        )
      }
    },
    [updateMetrics]
  )

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    performPendingScroll(listRef, pendingScrollRef)
    updateMetrics({ contentHeight: height })
  }, [updateMetrics])

  const handleScrollToIndexFailed = useCallback((info: {
    averageItemLength: number
    index: number
  }) => {
    if (!pendingFocusedMessageIdRef.current || info.index !== requestedTargetIndexRef.current || targetScrollRetriesRef.current >= 2) return
    targetScrollRetriesRef.current += 1
    listRef.current?.scrollToOffset({
      animated: false,
      offset: info.averageItemLength * info.index,
    })
    clearTimeout(scrollRetryTimerRef.current)
    const messageId = pendingFocusedMessageIdRef.current
    scrollRetryTimerRef.current = setTimeout(() => {
      if (pendingFocusedMessageIdRef.current !== messageId || requestedTargetIndexRef.current !== info.index) return
      listRef.current?.scrollToIndex({
        animated: false,
        index: info.index,
        viewPosition: 0.5,
      })
    }, 100)
  }, [])

  const handleJumpToLatest = useCallback(() => {
    nearBottomRef.current = true
    setPendingNewMessageCount(0)
    scheduleScrollToLatest(listRef, pendingScrollRef, true)
  }, [])

  if (error && messages.length === 0) {
    return (
      <ContentState message={error.message} tone="error">
        <View style={{ maxWidth: 240, width: "100%" }}>
          <AppButton
            accessibilityLabel="重新加载消息"
            onPress={onRetry}
            theme="gray"
            variant="outlined"
            width="100%"
          >
            重试
          </AppButton>
        </View>
      </ContentState>
    )
  }

  if (messages.length === 0) {
    return <View style={{ backgroundColor: colors.background0, flex: 1 }} />
  }

  return (
    <View style={{ backgroundColor: colors.background0, flex: 1 }}>
      <FlatList
        ref={listRef}
        contentContainerStyle={styles.content}
        data={listItems}
        inverted
        ItemSeparatorComponent={MessageItemSeparator}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={messageItemKeyExtractor}
        ListFooterComponent={
          <>
            {isFetchingOlder ? (
              <XGUILoadmore accessibilityLabel="正在加载更早的消息" />
            ) : hasOlder ? (
              <View style={{ alignItems: "center", paddingVertical: 12 }}>
                {olderError ? (
                  <Text style={{ color: colors.textPlaceholder, marginBottom: 8 }}>
                    加载更早消息失败
                  </Text>
                ) : null}
                <AppButton
                  accessibilityLabel={olderError ? "重试加载更早消息" : "加载更早消息"}
                  onPress={onRetryOlder}
                  theme="gray"
                  variant="outlined"
                >
                  {olderError ? "点击重试" : "加载更早消息"}
                </AppButton>
              </View>
            ) : null}
          </>
        }
        maintainVisibleContentPosition={maintainVisibleContentPosition}
        onContentSizeChange={handleContentSizeChange}
        onEndReached={onReachOlder}
        onLayout={(event) => updateMetrics({
          viewportHeight: event.nativeEvent.layout.height,
        })}
        onEndReachedThreshold={0.2}
        onScroll={handleScroll}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onTouchStart={onContentTouch}
        onViewableItemsChanged={handleViewableItemsChanged}
        renderItem={({ item }) =>
          item.type === "time" ? (
            <MessageTimeMarker
              color={colors.textPlaceholder}
              createdAt={item.createdAt}
            />
          ) : (
            <MessageBubble
              canAddReaction={
                canAddReaction && item.message.virtualType !== "topic_source"
              }
              canCreateTopic={
                canCreateTopic && item.message.virtualType !== "topic_source"
              }
              canRespondToChoice={
                canRespondToChoice && item.message.virtualType !== "topic_source"
              }
              currentUserId={currentUserId}
              highlighted={item.message.id === highlightedMessageId && highlightedMessageId === initialMessageId}
              highlightRequestKey={focusRequestKey}
              message={item.message}
              messageActionsEnabled={item.message.virtualType !== "topic_source"}
              optimisticClientMessageId={
                optimisticById.get(item.message.id)?.message.clientMessageId
              }
              optimisticStatus={optimisticById.get(item.message.id)?.status}
              onRetryMessage={onRetryMessage}
              onAvatarLongPress={onAvatarLongPress}
              onAvatarPress={onAvatarPress}
              onImagePress={onImagePress}
              onMentionPress={onMentionPress}
              onMessageLongPress={
                item.message.virtualType === "topic_source"
                  ? () => undefined
                  : onMessageLongPress
              }
              onLocateReplyMessage={item.message.virtualType === "topic_source" ? undefined : onLocateReplyMessage}
              onOpenTopic={onOpenTopic}
              onResourceError={onResourceError}
              onResourcePress={onResourcePress}
              onRespondChoice={
                item.message.virtualType === "topic_source"
                  ? undefined
                  : onRespondChoice
              }
              onSetReaction={
                item.message.virtualType === "topic_source"
                  ? undefined
                  : onSetReaction
              }
              onVoiceResourcePress={onVoiceResourcePress}
              resolveMentionLabel={resolveMentionLabel}
              resourceStates={resourceStates}
              server={server}
              showChoiceResponseCounts={showChoiceResponseCounts}
            />
          )
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={listStyle}
        viewabilityConfig={viewabilityConfig}
      />

      {pendingNewMessageCount > 0 ? (
        <View style={{ bottom: 18, justifyContent: "center", left: 0, position: "absolute", right: 0, flexDirection: "row" }}>
          <XGUIButton
            onPress={handleJumpToLatest}
            size="mini"
            style={[
              styles.newMessagesButton,
              { backgroundColor: colors.background4 },
            ]}
            variant="secondary"
          >
            <View style={styles.newMessagesContent}>
              <ArrowDown color={colors.textOnColor} size={18} />
              <Text
                style={[styles.newMessagesText, { color: colors.textOnColor }]}
              >
                {`${pendingNewMessageCount} 条新消息`}
              </Text>
            </View>
          </XGUIButton>
        </View>
      ) : null}
    </View>
  )
}

const maintainVisibleContentPosition = {
  autoscrollToTopThreshold: 80,
  minIndexForVisible: 0,
} as const

function MessageItemSeparator() {
  return <View style={{ height: 20 }} />
}

function messageItemKeyExtractor(item: MessageListItem) {
  return item.key
}

type PendingScroll = {
  animated: boolean
}

type MessageListItem =
  | {
      key: string
      message: PresentedMessage
      type: "message"
    }
  | {
      createdAt: string
      key: string
      type: "time"
    }

function buildMessageListItems(messages: PresentedMessage[]): MessageListItem[] {
  const items: MessageListItem[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message) continue

    items.push({ key: `message:${message.id}`, message, type: "message" })

    const olderMessage = messages[index + 1]
    if (
      olderMessage &&
      shouldShowMessageTimeMarker(olderMessage.createdAt, message.createdAt)
    ) {
      items.push({
        createdAt: message.createdAt,
        key: `time:${olderMessage.id}:${message.id}`,
        type: "time",
      })
    }
  }

  return items
}

function MessageTimeMarker({
  color,
  createdAt,
}: {
  color: ReturnType<typeof useXGUITheme>["colors"]["textPlaceholder"]
  createdAt: string
}) {
  const label = formatMessageTimeMarker(createdAt)
  if (!label) return null

  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ color, fontSize: 13, lineHeight: 20 }}>{label}</Text>
    </View>
  )
}

function scheduleScrollToLatest(
  listRef: React.RefObject<FlatList<MessageListItem> | null>,
  pendingScrollRef: React.MutableRefObject<PendingScroll | null>,
  animated: boolean
) {
  pendingScrollRef.current = { animated }
  requestAnimationFrame(() => performPendingScroll(listRef, pendingScrollRef))
}

function performPendingScroll(
  listRef: React.RefObject<FlatList<MessageListItem> | null>,
  pendingScrollRef: React.MutableRefObject<PendingScroll | null>
) {
  const list = listRef.current
  const pendingScroll = pendingScrollRef.current
  if (!list || !pendingScroll) return

  pendingScrollRef.current = null
  list.scrollToOffset({ animated: pendingScroll.animated, offset: 0 })
}

function getNewMessages(
  messages: PresentedMessage[],
  previousNewestMessageId: string | null,
  previousMessagesLength: number
) {
  const previousNewestIndex = previousNewestMessageId
    ? messages.findIndex((message) => message.id === previousNewestMessageId)
    : -1

  if (previousNewestIndex > 0) {
    return messages.slice(0, previousNewestIndex)
  }
  if (previousNewestIndex === 0) {
    return []
  }

  const addedCount = Math.max(messages.length - previousMessagesLength, 1)
  return messages.slice(0, addedCount)
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingBottom: 16,
    paddingTop: 16,
  },
  list: {
    flex: 1,
  },
  newMessagesButton: {
    borderRadius: 18,
    elevation: 4,
    height: 36,
    minHeight: 36,
    shadowColor: "#000000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  newMessagesContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  newMessagesText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
})
