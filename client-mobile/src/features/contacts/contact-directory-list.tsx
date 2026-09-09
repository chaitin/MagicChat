import {
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
} from "react"
import {
  Pressable,
  FlatList,
  PixelRatio,
  Platform,
  StyleSheet,
  View,
} from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import { ElasticOverscroll } from "@/components/layout/elastic-overscroll"
import type { ServerTarget } from "@/core/server-target"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import type {
  DirectoryItem,
  DirectorySection,
} from "@/features/contacts/contact-directory-model"
import { XGUIListCountFooter, useXGUITheme } from "@/xgui"

const DIRECTORY_ROW_HEIGHT = PixelRatio.roundToNearestPixel(64)

type DirectoryListRow = {
  item: DirectoryItem
  sectionTitle: string | null
}

export function ContactDirectoryList({
  emptyLabel,
  emptyMessageColor,
  errorMessage,
  footerNoun,
  listHeader,
  onItemPress,
  sections,
  server,
}: {
  emptyLabel: string
  emptyMessageColor?: ComponentProps<typeof ContentState>["messageColor"]
  errorMessage?: string
  footerNoun: string
  listHeader?: ReactElement
  onItemPress: (item: DirectoryItem) => void
  sections: DirectorySection[]
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  const listHeaderHeightRef = useRef(0)
  const rows = useMemo(
    () =>
      sections.flatMap((section) =>
        section.data.map((item) => ({
          item,
          sectionTitle: section.title ?? null,
        }))
      ),
    [sections]
  )
  return (
    <View style={styles.listContainer}>
      <ElasticOverscroll>
        {(elasticBindings) => <FlatList<DirectoryListRow>
        {...elasticBindings}
        alwaysBounceVertical
        bounces
        overScrollMode={Platform.OS === "android" ? "never" : "always"}
        contentContainerStyle={
          rows.length === 0 && !listHeader
            ? [styles.content, styles.emptyContent]
            : styles.content
        }
        data={rows}
        getItemLayout={(_data, index) => ({
          index,
          length: styles.row.height,
          offset: listHeaderHeightRef.current + styles.row.height * index,
        })}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.item.key}
        ListEmptyComponent={
          <ContentState
            message={`没有匹配的${emptyLabel}`}
            messageColor={emptyMessageColor}
          />
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <XGUIListCountFooter count={rows.length} noun={footerNoun} />
          ) : null
        }
        ListHeaderComponent={
          <View
            onLayout={(event) => {
              listHeaderHeightRef.current = event.nativeEvent.layout.height
            }}
          >
            {listHeader}
            <InlineError message={errorMessage} />
          </View>
        }
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={({ item: row }) => (
          <DirectoryListItem
            item={row.item}
            last={false}
            onPress={() => onItemPress(row.item)}
            server={server}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={[styles.list, { backgroundColor: colors.background0 }]}
        updateCellsBatchingPeriod={32}
        windowSize={7}
      />}
      </ElasticOverscroll>
    </View>
  )
}

function DirectoryListItem({
  item,
  last,
  onPress,
  server,
}: {
  item: DirectoryItem
  last: boolean
  onPress: () => void
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  let avatar: ReactElement
  let accessibilityLabel: string
  let subtitle: string
  let title: string

  if (item.type === "user") {
    const displayName = getContactDisplayName(item.value)
    accessibilityLabel = `查看联系人 ${displayName}`
    title = displayName
    subtitle = item.value.email
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        name={displayName}
        online={item.value.online}
        server={server}
        type="user"
      />
    )
  } else if (item.type === "app") {
    accessibilityLabel = `查看应用 ${item.value.name}`
    title = item.value.name
    subtitle = item.value.description || "智能应用"
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        name={item.value.name}
        online={item.value.online}
        server={server}
        type="app"
      />
    )
  } else {
    accessibilityLabel = `查看群组 ${item.value.name}`
    title = item.value.name
    subtitle = `${item.value.memberCount} 人 · ${
      item.value.joined ? "已加入" : "公开群组"
    }`
    avatar = (
      <ContactDirectoryAvatar
        avatar={item.value.avatar}
        members={item.value.avatarMembers}
        name={item.value.name}
        server={server}
        type="group"
      />
    )
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.background1 : colors.background2,
        },
      ]}
    >
      <View style={styles.avatar}>{avatar}</View>
      <View style={styles.rowContent}>
        <ListItemContent subtitle={subtitle} title={title} />
      </View>
      {!last ? (
        <View
          pointerEvents="none"
          style={[styles.separator, { backgroundColor: colors.separator }]}
        />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
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
  listContainer: {
    flex: 1,
    position: "relative",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: DIRECTORY_ROW_HEIGHT,
    paddingHorizontal: 16,
    position: "relative",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    bottom: StyleSheet.hairlineWidth,
    height: StyleSheet.hairlineWidth,
    left: 68,
    position: "absolute",
    right: 16,
  },
})
