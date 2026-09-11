import { useMemo } from "react"
import { SectionList, StyleSheet, Text, View } from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import type {
  ClientUser,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import { ProjectAvatar } from "@/features/projects/project-avatar"
import type { GlobalSearchResult } from "@/features/search/search-model"
import { XGUIListItem, useXGUITheme } from "@/xgui"

type SearchResultSection = {
  data: GlobalSearchResult[]
  title: string
}

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
  const { colors } = useXGUITheme()
  const sections = useMemo<SearchResultSection[]>(
    () =>
      [
        {
          data: results.filter((result) => result.type === "conversation"),
          title: "会话",
        },
        {
          data: results.filter((result) => result.type === "contact"),
          title: "联系人",
        },
        {
          data: results.filter((result) => result.type === "project"),
          title: "项目",
        },
      ].filter((section) => section.data.length > 0),
    [results]
  )

  return (
    <SectionList<GlobalSearchResult, SearchResultSection>
      contentContainerStyle={
        results.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(result) => result.key}
      ListEmptyComponent={<ContentState message="没有匹配的结果" />}
      renderSectionHeader={({ section }) => (
        <View
          style={[
            styles.sectionHeader,
            { backgroundColor: colors.background0 },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {section.title}
          </Text>
        </View>
      )}
      renderItem={({ index, item }) => (
        <SearchResultItem
          currentUser={currentUser}
          onPress={() => onResultPress(item)}
          result={item}
          separator={index > 0}
          server={server}
        />
      )}
      sections={sections}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />
  )
}

function SearchResultItem({
  currentUser,
  onPress,
  result,
  separator,
  server,
}: {
  currentUser: ClientUser | null
  onPress: () => void
  result: GlobalSearchResult
  separator: boolean
  server: ServerTarget
}) {
  if (result.type === "conversation") {
    const { conversation } = result
    return (
      <XGUIListItem
        accessibilityLabel={`打开会话 ${conversation.name}`}
        description={getConversationSubtitle(conversation)}
        leading={
          <ConversationAvatar
            conversation={conversation}
            server={server}
            surroundingBackground="$color1"
          />
        }
        onPress={onPress}
        separator={separator}
        title={conversation.name}
      />
    )
  }

  if (result.type === "contact") {
    const { contact } = result
    const displayName =
      contact.type === "user" ? getContactDisplayName(contact) : contact.name

    return (
      <XGUIListItem
        accessibilityLabel={`查看${getContactTypeLabel(contact.type)} ${displayName}`}
        description={getContactSubtitle(contact)}
        leading={
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
        separator={separator}
        title={displayName}
      />
    )
  }

  return (
    <XGUIListItem
      accessibilityLabel={`项目 ${result.project.name}`}
      description={`项目 · ${result.project.description.trim() || "暂无说明"}`}
      leading={
        <ProjectAvatar
          currentUser={currentUser}
          project={result.project}
          server={server}
        />
      }
      separator={separator}
      title={result.project.name}
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
  sectionHeader: {
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
})
