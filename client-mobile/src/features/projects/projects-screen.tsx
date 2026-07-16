import { RefreshCw, Search } from "lucide-react-native"
import { useMemo, useState } from "react"
import { Button, Paragraph, Spinner, XStack, YStack } from "tamagui"

import { AppInput } from "@/components/forms/app-input"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import { ProjectList } from "@/features/projects/project-list"
import { buildProjectListSections } from "@/features/projects/project-list-model"
import { useClientData } from "@/providers/client-data-provider"

export function ProjectsScreen() {
  const session = useAuthenticatedSession()
  const {
    currentUser,
    hasMoreProjects,
    isProjectsLoading,
    isProjectsLoadingMore,
    isProjectsRefreshing,
    loadMoreProjects,
    personalProject,
    projects,
    projectsError,
    refreshProjects,
  } = useClientData()
  const [keyword, setKeyword] = useState("")
  const hasKeyword = keyword.trim().length > 0
  const isProjectsBusy = isProjectsLoading || isProjectsRefreshing
  const sections = useMemo(
    () => buildProjectListSections({ keyword, personalProject, projects }),
    [keyword, personalProject, projects]
  )

  function handleRefresh() {
    void refreshProjects().catch(() => undefined)
  }

  function handleLoadMore() {
    void loadMoreProjects().catch(() => undefined)
  }

  return (
    <KeyboardAwareScreen edges={[]} scrollable={false}>
      <YStack gap="$3" p="$4" pb="$3">
        <XStack gap="$2" items="center">
          <ThemedIcon icon={Search} size={18} />
          <AppInput
            autoCapitalize="none"
            clearButtonMode="while-editing"
            flex={1}
            onChangeText={setKeyword}
            placeholder="搜索项目"
            returnKeyType="search"
            value={keyword}
          />
          <Button
            accessibilityLabel="刷新项目"
            circular
            disabled={isProjectsBusy}
            icon={
              isProjectsBusy ? (
                <Spinner />
              ) : (
                <ThemedIcon icon={RefreshCw} />
              )
            }
            onPress={handleRefresh}
            size="$4"
          />
        </XStack>

        {projectsError ? (
          <Paragraph color="$red10" size="$2">
            {projectsError.message}
          </Paragraph>
        ) : null}
      </YStack>

      {isProjectsLoading && !personalProject ? (
        <YStack flex={1} gap="$2" items="center" justify="center">
          <Spinner />
          <Paragraph color="$color10">正在加载项目</Paragraph>
        </YStack>
      ) : (
        <ProjectList
          currentUser={currentUser}
          hasKeyword={hasKeyword}
          hasMore={hasMoreProjects}
          isLoadingMore={isProjectsLoadingMore}
          isRefreshing={isProjectsRefreshing}
          onLoadMore={handleLoadMore}
          onRefresh={handleRefresh}
          sections={sections}
          serverUrl={session.url}
        />
      )}
    </KeyboardAwareScreen>
  )
}
