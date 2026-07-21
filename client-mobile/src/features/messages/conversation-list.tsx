import { FlatList, RefreshControl, StyleSheet } from "react-native"
import { ListItem, SizableText, useTheme } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import type { ServerTarget } from "@/data/query"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import type { ConversationListItemModel } from "@/features/messages/conversation-list-model"

export function ConversationList({
  errorMessage,
  hasKeyword,
  isRefreshing,
  items,
  onConversationPress,
  onRefresh,
  server,
}: {
  errorMessage?: string
  hasKeyword: boolean
  isRefreshing: boolean
  items: ConversationListItemModel[]
  onConversationPress: (conversationId: string) => void
  onRefresh: () => void
  server: ServerTarget
}) {
  const theme = useTheme()

  return (
    <FlatList
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
      ListHeaderComponent={<InlineError message={errorMessage} />}
      refreshControl={
        <RefreshControl
          colors={[String(theme.color10.val)]}
          onRefresh={onRefresh}
          refreshing={isRefreshing}
          tintColor={String(theme.color10.val)}
        />
      }
      renderItem={({ item }) => (
        <ConversationListItem
          item={item}
          onPress={() => onConversationPress(item.conversation.id)}
          server={server}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />
  )
}

function ConversationListItem({
  item,
  onPress,
  server,
}: {
  item: ConversationListItemModel
  onPress: () => void
  server: ServerTarget
}) {
  const { conversation } = item

  return (
    <ListItem
      accessibilityLabel={`打开会话 ${conversation.name}`}
      bg={conversation.pinned ? "$backgroundLight" : "transparent"}
      icon={
        <ConversationAvatar conversation={conversation} server={server} />
      }
      onPress={onPress}
      pressStyle={{ bg: "$backgroundPress" }}
      size="$4"
      title={
        <ListItemContent
          meta={item.lastMessageTime}
          subtitle={item.description}
          subtitleLeading={
            item.hasUnreadMention ? (
              <SizableText color="$red10" fontWeight="600" size="$2">
                [有人 @ 我]
              </SizableText>
            ) : undefined
          }
          title={conversation.name}
        />
      }
    />
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  emptyContent: {
    justifyContent: "center",
  },
  list: {
    flex: 1,
  },
})
