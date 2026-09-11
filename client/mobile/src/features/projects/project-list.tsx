import { useMemo } from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native"
import { useTheme, YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { AppButton } from "@/components/forms/app-button"
import { ListItemContent } from "@/components/lists/list-item-content"
import type { ClientProjectSummary, ClientUser } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { formatActivityTime } from "@/domain/time/activity-time"
import { ProjectAvatar } from "@/features/projects/project-avatar"
import type { ProjectListSection } from "@/features/projects/project-list-model"
import { XGUILoadingIcon, useXGUITheme, useXGUIToast } from "@/xgui"

export function ProjectList({
  currentUser,
  errorMessage,
  hasKeyword,
  hasMore,
  isLoadingMore,
  isRefreshing,
  onLoadMore,
  onRefresh,
  sections,
  server,
}: {
  currentUser: ClientUser | null
  errorMessage?: string
  hasKeyword: boolean
  hasMore: boolean
  isLoadingMore: boolean
  isRefreshing: boolean
  onLoadMore: () => void
  onRefresh: () => void
  sections: ProjectListSection[]
  server: ServerTarget
}) {
  const theme = useTheme()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const projects = useMemo(
    () => sections.flatMap((section) => section.data),
    [sections]
  )

  return (
    <FlatList<ClientProjectSummary>
      contentContainerStyle={
        projects.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      data={projects}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(project) => project.id}
      ListEmptyComponent={
        <ContentState message={hasKeyword ? "没有匹配的项目" : "暂无项目"} />
      }
      ListFooterComponent={
        hasMore && !hasKeyword ? (
          <YStack bg={colors.background0} p="$4">
            <AppButton
              accessibilityLabel="加载更多项目"
              disabled={isLoadingMore}
              icon={
                isLoadingMore ? (
                  <XGUILoadingIcon color={colors.textSecondary} size={20} />
                ) : undefined
              }
              onPress={onLoadMore}
              theme="gray"
              variant="outlined"
              width="100%"
            >
              {isLoadingMore ? "正在加载…" : "加载更多"}
            </AppButton>
          </YStack>
        ) : null
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
      renderItem={({ index, item }) => (
        <ProjectListItem
          currentUser={currentUser}
          last={index === projects.length - 1}
          onPress={() => {
            toast.show({
              duration: 1_000,
              message: "暂不支持查看",
              modal: false,
              type: "text",
            })
          }}
          project={item}
          server={server}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={[styles.list, { backgroundColor: colors.background0 }]}
    />
  )
}

function ProjectListItem({
  currentUser,
  last,
  onPress,
  project,
  server,
}: {
  currentUser: ClientUser | null
  last: boolean
  onPress: () => void
  project: ClientProjectSummary
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  const updatedAt = formatActivityTime(project.updatedAt)

  return (
    <Pressable
      accessibilityLabel={`查看项目 ${project.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.background1 : colors.background2,
        },
      ]}
    >
      <View style={styles.avatar}>
        <ProjectAvatar
          currentUser={currentUser}
          project={project}
          server={server}
        />
      </View>
      <View style={styles.rowContent}>
        <ListItemContent
          meta={updatedAt}
          subtitle={project.description.trim() || "暂无说明"}
          title={project.name}
        />
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
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: 64,
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
