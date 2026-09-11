import { ArrowDown } from "lucide-react-native"
import type { OptimisticMessage } from "@/features/conversation/optimistic-message-model"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native"
import {
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { AppButton } from "@/components/forms/app-button"
import { MessageBubble } from "@/features/conversation/messages/message-bubble"
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
  initialMessageId,
  isFetchingOlder,
  isLoading,
  messages,
  onAvatarPress,
  onAvatarLongPress,
  onContentTouch,
  onImagePress,
  onLoadOlder,
  onMessageLongPress,
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
  topicSourceMessage,
}: {
  canAddReaction: boolean
  canCreateTopic: boolean
  canRespondToChoice: boolean
  conversationId: string
  currentUserId: string
  error: Error | null
  hasOlder: boolean
  initialMessageId?: string
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
  topicSourceMessage?: PresentedMessage
}) {
  const { colors } = useXGUITheme()
  const listStyle = useMemo(
    () => [styles.list, { backgroundColor: colors.background0 }],
    [colors.background0]
  )
  const listItems = useMemo(() => buildMessageListItems(messages), [messages])
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
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [viewabilityConfig] = useState(() => ({ itemVisiblePercentThreshold: 50 }))
  const [highlightedMessageId, setHighlightedMessageId] = useState("")
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<MessageListItem>[] }) => {
      const pendingMessageId = pendingFocusedMessageIdRef.current
      if (!pendingMessageId) return
      const targetIsVisible = viewableItems.some(
        (token) =>
          token.isViewable &&
          token.item.type === "message" &&
          token.item.message.id === pendingMessageId
      )
      if (!targetIsVisible) return
      pendingFocusedMessageIdRef.current = ""
      focusedMessageIdRef.current = pendingMessageId
      setHighlightedMessageId(pendingMessageId)
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(
        () => setHighlightedMessageId(""),
        2_000
      )
    },
    []
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
    if (!initialMessageId || focusedMessageIdRef.current === initialMessageId) {
      return
    }
    const targetIndex = listItems.findIndex(
      (item) => item.type === "message" && item.message.id === initialMessageId
    )
    if (targetIndex < 0) return
    pendingFocusedMessageIdRef.current = initialMessageId
    targetScrollRetriesRef.current = 0
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        animated: false,
        index: targetIndex,
        viewPosition: 0.5,
      })
    })
  }, [initialMessageId, listItems])

  useEffect(
    () => () => {
      clearTimeout(highlightTimerRef.current)
    },
    []
  )

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nearBottom = event.nativeEvent.contentOffset.y <= 80
      nearBottomRef.current = nearBottom

      if (nearBottom) {
        setPendingNewMessageCount((currentCount) =>
          currentCount === 0 ? currentCount : 0
        )
      }
    },
    []
  )

  const handleContentSizeChange = useCallback(() => {
    performPendingScroll(listRef, pendingScrollRef)
  }, [])

  const handleScrollToIndexFailed = useCallback((info: {
    averageItemLength: number
    index: number
  }) => {
    if (targetScrollRetriesRef.current >= 2) return
    targetScrollRetriesRef.current += 1
    listRef.current?.scrollToOffset({
      animated: false,
      offset: info.averageItemLength * info.index,
    })
    setTimeout(() => {
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
        <YStack maxW={240} width="100%">
          <AppButton
            accessibilityLabel="重新加载消息"
            onPress={onRetry}
            theme="gray"
            variant="outlined"
            width="100%"
          >
            重试
          </AppButton>
        </YStack>
      </ContentState>
    )
  }

  if (messages.length === 0 && !topicSourceMessage) {
    return <YStack bg={colors.background0} flex={1} />
  }

  return (
    <YStack bg={colors.background0} flex={1} position="relative">
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
            ) : null}
            {!hasOlder && topicSourceMessage ? (
              <YStack pb="$3" pt="$2">
                <MessageBubble
                  canAddReaction={false}
                  canCreateTopic={false}
                  canRespondToChoice={false}
                  currentUserId={currentUserId}
                  message={topicSourceMessage}
                  messageActionsEnabled={false}
                  onAvatarPress={onAvatarPress}
                  onImagePress={onImagePress}
                  onMentionPress={onMentionPress}
                  onMessageLongPress={() => undefined}
                  onOpenTopic={onOpenTopic}
                  onResourceError={onResourceError}
                  onResourcePress={onResourcePress}
                  onVoiceResourcePress={onVoiceResourcePress}
                  resolveMentionLabel={resolveMentionLabel}
                  resourceStates={resourceStates}
                  server={server}
                  showChoiceResponseCounts={false}
                />
              </YStack>
            ) : null}
          </>
        }
        maintainVisibleContentPosition={maintainVisibleContentPosition}
        onContentSizeChange={handleContentSizeChange}
        onEndReached={hasOlder && !isFetchingOlder ? onLoadOlder : undefined}
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
              canAddReaction={canAddReaction}
              canCreateTopic={canCreateTopic}
              canRespondToChoice={canRespondToChoice}
              currentUserId={currentUserId}
              highlighted={item.message.id === highlightedMessageId}
              message={item.message}
              optimisticClientMessageId={
                optimisticById.get(item.message.id)?.message.clientMessageId
              }
              optimisticStatus={optimisticById.get(item.message.id)?.status}
              onRetryMessage={onRetryMessage}
              onAvatarLongPress={onAvatarLongPress}
              onAvatarPress={onAvatarPress}
              onImagePress={onImagePress}
              onMentionPress={onMentionPress}
              onMessageLongPress={onMessageLongPress}
              onOpenTopic={onOpenTopic}
              onResourceError={onResourceError}
              onResourcePress={onResourcePress}
              onRespondChoice={onRespondChoice}
              onSetReaction={onSetReaction}
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
        <XStack b="$4" justify="center" l={0} position="absolute" r={0}>
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
        </XStack>
      ) : null}
    </YStack>
  )
}

const maintainVisibleContentPosition = {
  autoscrollToTopThreshold: 80,
  minIndexForVisible: 0,
} as const

function MessageItemSeparator() {
  return <YStack height="$1" />
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
    <XStack justify="center">
      <SizableText color={color} size="$2">
        {label}
      </SizableText>
    </XStack>
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
