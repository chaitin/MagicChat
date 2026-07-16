import {
  RefreshControl,
  SectionList,
  StyleSheet,
  type SectionListRenderItemInfo,
} from "react-native"
import {
  Button,
  ListItem,
  Paragraph,
  Separator,
  SizableText,
  Spinner,
  XStack,
  YStack,
} from "tamagui"

import type { ClientProjectSummary, ClientUser } from "@/data/models"
import { formatActivityTime } from "@/domain/time/activity-time"
import { ProjectAvatar } from "@/features/projects/project-avatar"
import type { ProjectListSection } from "@/features/projects/project-list-model"

export function ProjectList({
  currentUser,
  hasKeyword,
  hasMore,
  isLoadingMore,
  isRefreshing,
  onLoadMore,
  onRefresh,
  sections,
  serverUrl,
}: {
  currentUser: ClientUser | null
  hasKeyword: boolean
  hasMore: boolean
  isLoadingMore: boolean
  isRefreshing: boolean
  onLoadMore: () => void
  onRefresh: () => void
  sections: ProjectListSection[]
  serverUrl: string
}) {
  return (
    <SectionList<ClientProjectSummary, ProjectListSection>
      contentContainerStyle={
        sections.length === 0
          ? [styles.content, styles.emptyContent]
          : styles.content
      }
      ItemSeparatorComponent={() => <Separator />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(project) => project.id}
      ListEmptyComponent={
        <YStack flex={1} items="center" justify="center" p="$8">
          <Paragraph color="$color10" text="center">
            {hasKeyword ? "没有匹配的项目" : "暂无项目"}
          </Paragraph>
        </YStack>
      }
      ListFooterComponent={
        hasMore && !hasKeyword ? (
          <YStack p="$4">
            <Button
              disabled={isLoadingMore}
              icon={isLoadingMore ? <Spinner /> : undefined}
              onPress={onLoadMore}
              variant="outlined"
            >
              {isLoadingMore ? "正在加载…" : "加载更多"}
            </Button>
          </YStack>
        ) : null
      }
      refreshControl={
        <RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} />
      }
      renderItem={(itemInfo) => (
        <ProjectListItem
          currentUser={currentUser}
          itemInfo={itemInfo}
          serverUrl={serverUrl}
        />
      )}
      renderSectionHeader={({ section }) =>
        section.title ? (
          <XStack bg="$background" pb="$2" pt="$4" px="$4">
            <Paragraph fontWeight="600">{section.title}</Paragraph>
          </XStack>
        ) : null
      }
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
  serverUrl,
}: {
  currentUser: ClientUser | null
  itemInfo: SectionListRenderItemInfo<
    ClientProjectSummary,
    ProjectListSection
  >
  serverUrl: string
}) {
  const { item: project } = itemInfo
  const updatedAt = formatActivityTime(project.updatedAt)

  return (
    <ListItem
      icon={
        <ProjectAvatar
          currentUser={currentUser}
          project={project}
          serverUrl={serverUrl}
        />
      }
      size="$5"
      subTitle={project.description.trim() || "暂无说明"}
      title={
        <XStack gap="$2" items="center" maxW="100%">
          <SizableText flex={1} fontWeight="500" numberOfLines={1}>
            {project.name}
          </SizableText>
          {updatedAt ? (
            <SizableText color="$color10" size="$2">
              {updatedAt}
            </SizableText>
          ) : null}
        </XStack>
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
