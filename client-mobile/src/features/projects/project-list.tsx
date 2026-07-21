import {
  RefreshControl,
  SectionList,
  StyleSheet,
  type SectionListRenderItemInfo,
} from "react-native"
import {
  ListItem,
  Spinner,
  useTheme,
  YStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { ContentState } from "@/components/feedback/content-state"
import { InlineError } from "@/components/feedback/inline-error"
import { ListItemContent } from "@/components/lists/list-item-content"
import type { ClientProjectSummary, ClientUser } from "@/data/models"
import type { ServerTarget } from "@/data/query"
import { formatActivityTime } from "@/domain/time/activity-time"
import { ProjectAvatar } from "@/features/projects/project-avatar"
import type { ProjectListSection } from "@/features/projects/project-list-model"

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

  return (
    <SectionList<ClientProjectSummary, ProjectListSection>
      contentContainerStyle={
        sections.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(project) => project.id}
      ListEmptyComponent={
        <ContentState message={hasKeyword ? "没有匹配的项目" : "暂无项目"} />
      }
      ListHeaderComponent={<InlineError message={errorMessage} />}
      ListFooterComponent={
        hasMore && !hasKeyword ? (
          <YStack p="$4">
            <AppButton
              accessibilityLabel="加载更多项目"
              disabled={isLoadingMore}
              icon={isLoadingMore ? <Spinner /> : undefined}
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
      refreshControl={
        <RefreshControl
          colors={[String(theme.color10.val)]}
          onRefresh={onRefresh}
          refreshing={isRefreshing}
          tintColor={String(theme.color10.val)}
        />
      }
      renderItem={(itemInfo) => (
        <ProjectListItem
          currentUser={currentUser}
          itemInfo={itemInfo}
          server={server}
        />
      )}
      sections={sections}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      style={styles.list}
    />
  )
}

function ProjectListItem({
  currentUser,
  itemInfo,
  server,
}: {
  currentUser: ClientUser | null
  itemInfo: SectionListRenderItemInfo<
    ClientProjectSummary,
    ProjectListSection
  >
  server: ServerTarget
}) {
  const { item: project } = itemInfo
  const updatedAt = formatActivityTime(project.updatedAt)

  return (
    <ListItem
      bg="transparent"
      icon={
        <ProjectAvatar
          currentUser={currentUser}
          project={project}
          server={server}
        />
      }
      pressStyle={{ bg: "$backgroundPress" }}
      size="$4"
      title={
        <ListItemContent
          meta={updatedAt}
          subtitle={project.description.trim() || "暂无说明"}
          title={project.name}
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
