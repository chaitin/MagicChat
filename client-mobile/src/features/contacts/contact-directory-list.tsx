import {
  RefreshControl,
  SectionList,
  StyleSheet,
  type SectionListRenderItemInfo,
} from "react-native"
import {
  ListItem,
  Paragraph,
  useTheme,
  XStack,
} from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import type { ServerTarget } from "@/data/query"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import {
  type DirectoryItem,
  type DirectorySection,
} from "@/features/contacts/contact-directory-model"

export function ContactDirectoryList({
  emptyLabel,
  errorMessage,
  isRefreshing,
  onRefresh,
  onItemPress,
  sections,
  server,
}: {
  emptyLabel: string
  errorMessage?: string
  isRefreshing: boolean
  onRefresh: () => void
  onItemPress: (item: DirectoryItem) => void
  sections: DirectorySection[]
  server: ServerTarget
}) {
  const theme = useTheme()

  return (
    <SectionList<DirectoryItem, DirectorySection>
      contentContainerStyle={
        sections.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.key}
      ListEmptyComponent={
        <ContentState message={`没有匹配的${emptyLabel}`} />
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
      renderItem={(itemInfo) => (
        <DirectoryListItem
          itemInfo={itemInfo}
          onPress={() => onItemPress(itemInfo.item)}
          server={server}
        />
      )}
      renderSectionHeader={({ section }) =>
        section.title ? <DirectorySectionHeader section={section} /> : null
      }
      sections={sections}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      style={styles.list}
    />
  )
}

function DirectorySectionHeader({ section }: { section: DirectorySection }) {
  return (
    <XStack
      bg="transparent"
      items="center"
      justify="space-between"
      pb="$2"
      pt="$4"
      px="$4"
    >
      <Paragraph color="$color10" size="$2">
        {section.title}
      </Paragraph>
      <Paragraph bg="$color2" color="$color10" px="$2" rounded="$10" size="$1">
        {section.count}
      </Paragraph>
    </XStack>
  )
}

function DirectoryListItem({
  itemInfo,
  onPress,
  server,
}: {
  itemInfo: SectionListRenderItemInfo<DirectoryItem, DirectorySection>
  onPress: () => void
  server: ServerTarget
}) {
  const { item } = itemInfo

  if (item.type === "user") {
    const displayName = getContactDisplayName(item.value)

    return (
      <ListItem
        accessibilityLabel={`查看联系人 ${displayName}`}
        bg="transparent"
        icon={
          <ContactDirectoryAvatar
            avatar={item.value.avatar}
            name={displayName}
            online={item.value.online}
            server={server}
            type="user"
          />
        }
        onPress={onPress}
        pressStyle={{ bg: "$backgroundPress" }}
        size="$4"
        title={
          <ListItemContent
            subtitle={item.value.email}
            title={displayName}
          />
        }
      />
    )
  }

  if (item.type === "app") {
    return (
      <ListItem
        accessibilityLabel={`查看应用 ${item.value.name}`}
        bg="transparent"
        icon={
          <ContactDirectoryAvatar
            avatar={item.value.avatar}
            name={item.value.name}
            online={item.value.online}
            server={server}
            type="app"
          />
        }
        onPress={onPress}
        pressStyle={{ bg: "$backgroundPress" }}
        size="$4"
        title={
          <ListItemContent
            subtitle={item.value.description || "智能应用"}
            title={item.value.name}
          />
        }
      />
    )
  }

  return (
    <ListItem
      accessibilityLabel={`查看群组 ${item.value.name}`}
      bg="transparent"
      icon={
        <ContactDirectoryAvatar
          avatar={item.value.avatar}
          members={item.value.avatarMembers}
          name={item.value.name}
          server={server}
          type="group"
        />
      }
      onPress={onPress}
      pressStyle={{ bg: "$backgroundPress" }}
      size="$4"
      title={
        <ListItemContent
          subtitle={`${item.value.memberCount} 人 · ${
            item.value.joined ? "已加入" : "公开群组"
          }`}
          title={item.value.name}
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
