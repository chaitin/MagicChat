import { Navigate, useSearchParams } from "react-router"

import { ProjectTasksTab } from "@/components/projects/project-tasks-tab"
import { useProjectDetail } from "@/pages/projects/project-detail-context"

export function ProjectTasksPage() {
  const { onProjectUpdated, project } = useProjectDetail()
  const [searchParams] = useSearchParams()
  const taskId = searchParams.get("taskId")?.trim()

  if (taskId) {
    return (
      <Navigate
        replace
        to={`/tasks/${encodeURIComponent(project.id)}/${encodeURIComponent(taskId)}`}
      />
    )
  }

  return (
    <ProjectTasksTab
      key={project.id}
      onTasksChanged={onProjectUpdated}
      projectId={project.id}
    />
  )
}
