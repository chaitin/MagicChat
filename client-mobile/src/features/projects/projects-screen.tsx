import { useMemo } from "react"

import { ContentState } from "@/components/feedback/content-state"
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
    <KeyboardAwareScreen
      contentBackground="$color1"
      edges={[]}
      scrollable={false}
    >
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
  )
}
