import { useRouter } from "expo-router"
import { useMemo } from "react"
import { View } from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { ProjectList } from "@/features/projects/project-list"
import { buildProjectListSections } from "@/features/projects/project-list-model"
import { useXGUITheme } from "@/xgui"
import { useClientProjects, useClientSession } from "@/providers/client-data-provider"

export function ProjectsScreen() {
  const { colors } = useXGUITheme()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { currentUser } = useClientSession()
  const {
    hasMoreProjects,
    isProjectsLoading,
    isProjectsLoadingMore,
    isProjectsRefreshing,
    loadMoreProjects,
    personalProject,
    projects,
    projectsError,
    refreshProjects,
  } = useClientProjects()
  const sections = useMemo(
    () => buildProjectListSections({ keyword: "", personalProject, projects }),
    [personalProject, projects]
  )

  function handleRefresh() {
    void refreshProjects().catch(() => undefined)
  }

  function handleLoadMore() {
    void loadMoreProjects().catch(() => undefined)
  }

  return (
    <View style={{ backgroundColor: colors.background0, flex: 1 }}>
      <AppHeader onBackPress={() => router.back()} title="项目" />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={[]}
        scrollable={false}
      >
        <View style={{ height: 8 }} />
        {isProjectsLoading && !personalProject ? (
          <ContentState loading message="正在加载项目" />
        ) : (
          <ProjectList
            currentUser={currentUser}
            errorMessage={projectsError?.message}
            hasKeyword={false}
            hasMore={hasMoreProjects}
            isLoadingMore={isProjectsLoadingMore}
            isRefreshing={isProjectsRefreshing}
            onLoadMore={handleLoadMore}
            onRefresh={handleRefresh}
            sections={sections}
            server={session}
          />
        )}
      </KeyboardAwareScreen>
    </View>
  )
}
