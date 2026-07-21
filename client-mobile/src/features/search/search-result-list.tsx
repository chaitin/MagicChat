import { FlatList, StyleSheet } from "react-native"
import { ListItem } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { ListItemContent } from "@/components/lists/list-item-content"
import type {
  ClientUser,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/data/models"
import type { ServerTarget } from "@/data/query"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import { ProjectAvatar } from "@/features/projects/project-avatar"
import type { GlobalSearchResult } from "@/features/search/search-model"

export function SearchResultList({
  currentUser,
  onResultPress,
  results,
  server,
}: {
  currentUser: ClientUser | null
  onResultPress: (result: GlobalSearchResult) => void
  results: GlobalSearchResult[]
  server: ServerTarget
}) {
  return (
    <FlatList
      contentContainerStyle={
        results.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      data={results}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(result) => result.key}
      ListEmptyComponent={<ContentState message="没有匹配的结果" />}
      renderItem={({ item }) => (
        <SearchResultItem
          currentUser={currentUser}
          onPress={() => onResultPress(item)}
          result={item}
          server={server}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />
  )
}

function SearchResultItem({
  currentUser,
  onPress,
  result,
  server,
}: {
  currentUser: ClientUser | null
  onPress: () => void
  result: GlobalSearchResult
  server: ServerTarget
}) {
  if (result.type === "conversation") {
    const { conversation } = result
    return (
      <ListItem
        accessibilityLabel={`打开会话 ${conversation.name}`}
        bg="transparent"
        icon={
          <ConversationAvatar
            conversation={conversation}
            server={server}
          />
        }
        onPress={onPress}
        size="$4"
        title={
          <ListItemContent
            subtitle={getConversationSubtitle(conversation)}
            title={conversation.name}
          />
        }
      />
    )
  }

  if (result.type === "contact") {
    const { contact } = result
    const displayName =
      contact.type === "user" ? getContactDisplayName(contact) : contact.name

    return (
      <ListItem
        accessibilityLabel={`查看${getContactTypeLabel(contact.type)} ${displayName}`}
        bg="transparent"
        icon={
          <ContactDirectoryAvatar
            avatar={contact.avatar}
            members={contact.type === "group" ? contact.avatarMembers : undefined}
            name={displayName}
            online={contact.type === "group" ? undefined : contact.online}
            server={server}
            type={contact.type}
          />
        }
        onPress={onPress}
        size="$4"
        title={
          <ListItemContent
            subtitle={getContactSubtitle(contact)}
            title={displayName}
          />
        }
      />
    )
  }

  return (
    <ListItem
      accessibilityLabel={`项目 ${result.project.name}`}
      bg="transparent"
      icon={
        <ProjectAvatar
          currentUser={currentUser}
          project={result.project}
          server={server}
        />
      }
      size="$4"
      title={
        <ListItemContent
          subtitle={`项目 · ${result.project.description.trim() || "暂无说明"}`}
          title={result.project.name}
        />
      }
    />
  )
}

function getConversationSubtitle(conversation: {
  memberCount: number
  type: "app" | "direct" | "group" | "topic"
}) {
  if (conversation.type === "app") return "对话 · 应用"
  if (conversation.type === "direct") return "对话 · 私聊"
  if (conversation.type === "topic") return "对话 · 话题"
  return `对话 · ${conversation.memberCount} 人群聊`
}

function getContactSubtitle(
  contact: ContactApp | ContactGroup | ContactUser
) {
  if (contact.type === "user") return `联系人 · ${contact.email}`
  if (contact.type === "app") {
    return `应用 · ${contact.description.trim() || "智能应用"}`
  }
  return `群组 · ${contact.memberCount} 人`
}

function getContactTypeLabel(type: "app" | "group" | "user") {
  if (type === "app") return "应用"
  if (type === "group") return "群组"
  return "联系人"
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
