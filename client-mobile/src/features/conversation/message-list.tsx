import { ArrowDown } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import { Button, Paragraph, Spinner, XStack, YStack } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { MessageBubble } from "@/features/conversation/message-bubble"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type {
  MessageMentionLabelResolver,
  PresentedMessage,
} from "@/domain/messages/message-presenter"

export function MessageList({
  conversationId,
  error,
  fileUrls,
  fileUrlsLoading,
  hasOlder,
  isFetchingOlder,
  isLoading,
  isRefreshing,
  messages,
  onAvatarPress,
  onLoadOlder,
  onRefresh,
  resolveMentionLabel,
  serverUrl,
}: {
  conversationId: string
  error: Error | null
  fileUrls: ReadonlyMap<string, string>
  fileUrlsLoading: boolean
  hasOlder: boolean
  isFetchingOlder: boolean
  isLoading: boolean
  isRefreshing: boolean
  messages: PresentedMessage[]
  onAvatarPress: (sender: EntityReference) => void
  onLoadOlder: () => void
  onRefresh: () => void
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
}) {
  const listRef = useRef<FlatList<PresentedMessage>>(null)
  const nearBottomRef = useRef(true)
  const initializedMessagesRef = useRef(false)
  const previousConversationIdRef = useRef("")
  const previousNewestMessageIdRef = useRef<string | null>(null)
  const previousMessagesLengthRef = useRef(0)
  const pendingScrollRef = useRef<PendingScroll>(null)
  const [pendingNewMessageCount, setPendingNewMessageCount] = useState(0)

  useEffect(() => {
    if (previousConversationIdRef.current !== conversationId) {
      previousConversationIdRef.current = conversationId
      previousNewestMessageIdRef.current = null
      previousMessagesLengthRef.current = 0
      initializedMessagesRef.current = false
      nearBottomRef.current = true
      pendingScrollRef.current = null
      setPendingNewMessageCount(0)
    }

    if (!initializedMessagesRef.current) {
      if (!isLoading) {
        initializedMessagesRef.current = true
        previousNewestMessageIdRef.current = messages[0]?.id ?? null
        previousMessagesLengthRef.current = messages.length
        if (messages.length > 0) {
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
  }, [conversationId, isLoading, messages])

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nearBottom = event.nativeEvent.contentOffset.y <= 80
    nearBottomRef.current = nearBottom

    if (nearBottom) {
      setPendingNewMessageCount((currentCount) =>
        currentCount === 0 ? currentCount : 0
      )
    }
  }

  function handleContentSizeChange() {
    performPendingScroll(listRef, pendingScrollRef)
  }

  function handleJumpToLatest() {
    nearBottomRef.current = true
    setPendingNewMessageCount(0)
    scheduleScrollToLatest(listRef, pendingScrollRef, true)
  }

  if (isLoading) {
    return (
      <YStack flex={1} gap="$2" items="center" justify="center">
        <Spinner />
        <Paragraph color="$color10">正在加载消息</Paragraph>
      </YStack>
    )
  }

  if (error && messages.length === 0) {
    return (
      <YStack flex={1} gap="$3" items="center" justify="center" p="$6">
        <Paragraph color="$color10" text="center">
          {error.message}
        </Paragraph>
        <Button onPress={onRefresh} variant="outlined">
          重试
        </Button>
      </YStack>
    )
  }

  if (messages.length === 0) {
    return (
      <YStack flex={1} gap="$1" items="center" justify="center" p="$6">
        <Paragraph fontWeight="600">暂无消息</Paragraph>
        <Paragraph color="$color10">发送第一条消息开始对话</Paragraph>
      </YStack>
    )
  }

  return (
    <YStack flex={1} position="relative">
      <FlatList
        ref={listRef}
        contentContainerStyle={styles.content}
        data={messages}
        inverted
        ItemSeparatorComponent={() => <YStack height="$4" />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        ListFooterComponent={
          hasOlder || isFetchingOlder ? (
            <YStack items="center" pb="$3">
              <Button
                disabled={isFetchingOlder}
                icon={isFetchingOlder ? <Spinner /> : undefined}
                onPress={onLoadOlder}
                size="$3"
                variant="outlined"
              >
                {isFetchingOlder ? "正在加载" : "加载更早消息"}
              </Button>
            </YStack>
          ) : null
        }
        maintainVisibleContentPosition={{
          autoscrollToTopThreshold: 80,
          minIndexForVisible: 0,
        }}
        onContentSizeChange={handleContentSizeChange}
        onEndReached={hasOlder && !isFetchingOlder ? onLoadOlder : undefined}
        onEndReachedThreshold={0.2}
        onScroll={handleScroll}
        refreshControl={
          <RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} />
        }
        renderItem={({ item }) => (
          <MessageBubble
            fileUrls={fileUrls}
            fileUrlsLoading={fileUrlsLoading}
            message={item}
            onAvatarPress={onAvatarPress}
            resolveMentionLabel={resolveMentionLabel}
            serverUrl={serverUrl}
          />
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />

      {pendingNewMessageCount > 0 ? (
        <XStack b="$4" justify="center" l={0} position="absolute" r={0}>
          <Button
            icon={<ThemedIcon icon={ArrowDown} size={18} />}
            onPress={handleJumpToLatest}
            rounded="$10"
            size="$3"
          >
            {pendingNewMessageCount} 条新消息
          </Button>
        </XStack>
      ) : null}
    </YStack>
  )
}

type PendingScroll = {
  animated: boolean
}

function scheduleScrollToLatest(
  listRef: React.RefObject<FlatList<PresentedMessage> | null>,
  pendingScrollRef: React.MutableRefObject<PendingScroll | null>,
  animated: boolean
) {
  pendingScrollRef.current = { animated }
  requestAnimationFrame(() => performPendingScroll(listRef, pendingScrollRef))
}

function performPendingScroll(
  listRef: React.RefObject<FlatList<PresentedMessage> | null>,
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
    paddingBottom: 16,
    paddingTop: 16,
  },
  list: {
    flex: 1,
  },
})
