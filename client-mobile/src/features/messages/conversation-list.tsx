import * as Haptics from "expo-haptics"
import { useEffect, useRef } from "react"
import {
  FlatList,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable"
import { SizableText } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import { ElasticOverscroll } from "@/components/layout/elastic-overscroll"
import type { ServerTarget } from "@/core/server-target"
import { isBuiltinAssistantConversation } from "@/domain/conversations/conversation-order"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import {
  findLatestUnreadConversationIndex,
  getBoundedConversationIds,
  type ConversationListItemModel,
} from "@/features/messages/conversation-list-model"
import { ConversationPreferenceIndicators } from "@/features/messages/conversation-preference-indicators"
import {
  XGUIFilledSearchBar,
  XGUIListCountFooter,
  useXGUITheme,
} from "@/xgui"

const PARENT_ROW_HEIGHT = PixelRatio.roundToNearestPixel(64)
const NESTED_ROW_HEIGHT = PixelRatio.roundToNearestPixel(52)
const VISIBLE_CONVERSATION_HYDRATION_LIMIT = 30

export function ConversationList({
  errorMessage,
  hasKeyword,
  items,
  onConversationDelete,
  onConversationLongPress,
  onConversationMutedChange,
  onConversationPinnedChange,
  onConversationPress,
  onConversationPressIn,
  onConversationsVisible,
  onSearchPress,
  scrollToUnreadRequest = 0,
  server,
}: {
  errorMessage?: string
  hasKeyword: boolean
  items: ConversationListItemModel[]
  onConversationDelete: (item: ConversationListItemModel) => void
  onConversationLongPress: (item: ConversationListItemModel) => void
  onConversationMutedChange: (
    item: ConversationListItemModel,
    muted: boolean
  ) => void
  onConversationPinnedChange: (
    item: ConversationListItemModel,
    pinned: boolean
  ) => void
  onConversationPress: (conversationId: string) => void
  onConversationPressIn: (conversationId: string) => void
  onConversationsVisible: (conversationIds: string[]) => void
  onSearchPress: () => void
  scrollToUnreadRequest?: number
  server: ServerTarget
}) {
  const listRef = useRef<FlatList<ConversationListItemModel>>(null)
  const openSwipeableRef = useRef<SwipeableMethods | null>(null)
  const onConversationsVisibleRef = useRef(onConversationsVisible)
  useEffect(() => {
    onConversationsVisibleRef.current = onConversationsVisible
  }, [onConversationsVisible])
  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: { item: ConversationListItemModel }[] }) => {
      onConversationsVisibleRef.current(
        getBoundedConversationIds(
          viewableItems.map(({ item }) => item),
          VISIBLE_CONVERSATION_HYDRATION_LIMIT
        )
      )
    }
  )
  const latestUnreadIndex = findLatestUnreadConversationIndex(items)

  useEffect(() => {
    if (scrollToUnreadRequest === 0 || latestUnreadIndex < 0) return

    openSwipeableRef.current?.close()
    listRef.current?.scrollToIndex({
      animated: true,
      index: latestUnreadIndex,
      viewOffset: 8,
      viewPosition: 0,
    })
  }, [latestUnreadIndex, scrollToUnreadRequest])

  return (
    <ElasticOverscroll>
      {(elasticBindings) => <FlatList
      {...elasticBindings}
      alwaysBounceVertical
      bounces
      overScrollMode={Platform.OS === "android" ? "never" : "always"}
      contentContainerStyle={
        items.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      data={items}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.conversation.id}
      ListEmptyComponent={
        <ContentState message={hasKeyword ? "没有匹配的会话" : "暂无会话"} />
      }
      ListFooterComponent={
        items.length > 0 ? (
          <XGUIListCountFooter count={items.length} noun="对话" />
        ) : null
      }
      ListHeaderComponent={
        <View>
          <XGUIFilledSearchBar
            accessibilityLabel="搜索消息、联系人和项目"
            onPress={onSearchPress}
          />
          <InlineError message={errorMessage} />
        </View>
      }
      onScrollBeginDrag={() => openSwipeableRef.current?.close()}
      onScrollToIndexFailed={({ averageItemLength, index }) => {
        listRef.current?.scrollToOffset({
          animated: false,
          offset: averageItemLength * index,
        })
        setTimeout(() => {
          listRef.current?.scrollToIndex({
            animated: true,
            index,
            viewOffset: 8,
            viewPosition: 0,
          })
        }, 50)
      }}
      onViewableItemsChanged={onViewableItemsChangedRef.current}
      ref={listRef}
      renderItem={({ item }) => (
        <ConversationListItem
          item={item}
          last={false}
          onDelete={() => onConversationDelete(item)}
          onLongPress={() => onConversationLongPress(item)}
          onMutedChange={(muted) => onConversationMutedChange(item, muted)}
          onPinnedChange={(pinned) => onConversationPinnedChange(item, pinned)}
          onPress={() => onConversationPress(item.conversation.id)}
          onPressIn={() => {
            openSwipeableRef.current?.close()
            onConversationPressIn(item.conversation.id)
          }}
          onSwipeableClose={(swipeable) => {
            if (openSwipeableRef.current === swipeable) {
              openSwipeableRef.current = null
            }
          }}
          onSwipeableWillOpen={(swipeable) => {
            if (
              openSwipeableRef.current &&
              openSwipeableRef.current !== swipeable
            ) {
              openSwipeableRef.current.close()
            }
            openSwipeableRef.current = swipeable
          }}
          server={server}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />}
    </ElasticOverscroll>
  )
}

function ConversationListItem({
  item,
  last,
  onDelete,
  onLongPress,
  onMutedChange,
  onPinnedChange,
  onPress,
  onPressIn,
  onSwipeableClose,
  onSwipeableWillOpen,
  server,
}: {
  item: ConversationListItemModel
  last: boolean
  onDelete: () => void
  onLongPress: () => void
  onMutedChange: (muted: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  onPress: () => void
  onPressIn: () => void
  onSwipeableClose: (swipeable: SwipeableMethods) => void
  onSwipeableWillOpen: (swipeable: SwipeableMethods) => void
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  const { conversation } = item
  const didLongPressRef = useRef(false)
  const swipeableRef = useRef<SwipeableMethods | null>(null)
  const swipable = conversation.type !== "topic"
  const rowBackground = item.pinnedBackground
    ? colors.background0
    : colors.background2

  function handlePress() {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }

    onPress()
  }

  const content = (
    <Pressable
      accessibilityLabel={`打开会话 ${conversation.name}`}
      delayLongPress={500}
      onLongPress={() => {
        didLongPressRef.current = true
        if (conversation.type === "topic") return

        swipeableRef.current?.close()
        void performLongPressHaptic()
        onLongPress()
      }}
      onPress={handlePress}
      onPressIn={() => {
        didLongPressRef.current = false
        onPressIn()
      }}
      style={({ pressed }) => [
        styles.row,
        item.nested ? styles.nestedRow : styles.parentRow,
        {
          backgroundColor: pressed ? colors.background1 : rowBackground,
        },
      ]}
    >
      <View style={styles.avatar}>
        <ConversationAvatar
          conversation={conversation}
          server={server}
          surroundingBackground="$backgroundLight"
          topicSourceOnly={item.nested}
        />
      </View>
      <View style={styles.rowContent}>
        <ListItemContent
          compact={item.nested}
          meta={item.lastMessageTime}
          subtitle={item.description}
          subtitleLeading={
            item.unreadAlertLabel ? (
              <SizableText
                color={colors.destructive}
                fontSize={item.nested ? 12 : 14}
                fontWeight="600"
                lineHeight={item.nested ? 17 : 20}
              >
                {item.unreadAlertLabel}
              </SizableText>
            ) : undefined
          }
          subtitleTrailing={
            <ConversationPreferenceIndicators conversation={conversation} />
          }
          title={conversation.name}
        />
      </View>
      {!last ? (
        <View
          pointerEvents="none"
          style={[
            styles.separator,
            { backgroundColor: colors.separator },
          ]}
        />
      ) : null}
    </Pressable>
  )

  if (!swipable) {
    return content
  }

  return (
    <ReanimatedSwipeable
      friction={2}
      onSwipeableClose={() => {
        if (swipeableRef.current) onSwipeableClose(swipeableRef.current)
      }}
      onSwipeableWillOpen={() => {
        if (swipeableRef.current) onSwipeableWillOpen(swipeableRef.current)
      }}
      overshootRight={false}
      ref={swipeableRef}
      renderRightActions={() => (
        <ConversationSwipeActions
          item={item}
          onDelete={() => {
            swipeableRef.current?.close()
            onDelete()
          }}
          onMutedChange={(muted) => {
            swipeableRef.current?.close()
            onMutedChange(muted)
          }}
          onPinnedChange={(pinned) => {
            swipeableRef.current?.close()
            onPinnedChange(pinned)
          }}
        />
      )}
      rightThreshold={40}
    >
      {content}
    </ReanimatedSwipeable>
  )
}

function ConversationSwipeActions({
  item,
  onDelete,
  onMutedChange,
  onPinnedChange,
}: {
  item: ConversationListItemModel
  onDelete: () => void
  onMutedChange: (muted: boolean) => void
  onPinnedChange: (pinned: boolean) => void
}) {
  const { colors } = useXGUITheme()
  const { conversation } = item
  const canPin = !isBuiltinAssistantConversation(conversation)

  return (
    <View style={styles.actions}>
      {canPin ? (
        <SwipeAction
          backgroundColor={colors.indigo}
          label={conversation.pinned ? "取消置顶" : "置顶"}
          onPress={() => onPinnedChange(!conversation.pinned)}
        />
      ) : null}
      <SwipeAction
        backgroundColor={colors.informationBarTipsStrongBackground}
        label={conversation.notificationMuted ? "取消免打扰" : "免打扰"}
        onPress={() => onMutedChange(!conversation.notificationMuted)}
      />
      <SwipeAction
        backgroundColor={colors.destructive}
        label="删除"
        onPress={onDelete}
      />
    </View>
  )
}

function SwipeAction({
  backgroundColor,
  label,
  onPress,
}: {
  backgroundColor: string
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  )
}

async function performLongPressHaptic() {
  if (Platform.OS === "web") return

  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(
        Haptics.AndroidHaptics.Long_Press
      )
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  } catch {
    // Haptics are optional feedback and must not block opening the action sheet.
  }
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    width: 80,
  },
  actionText: {
    color: "#FFFFFF",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
  },
  avatar: {
    alignItems: "center",
    marginRight: 10,
    width: 44,
  },
  content: {
    flexGrow: 1,
  },
  emptyContent: {
    justifyContent: "center",
  },
  list: {
    flex: 1,
  },
  nestedRow: {
    height: NESTED_ROW_HEIGHT,
    paddingVertical: 4,
  },
  parentRow: {
    height: PARENT_ROW_HEIGHT,
    paddingVertical: 10,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 16,
    position: "relative",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 68,
    position: "absolute",
    right: 16,
  },
})
