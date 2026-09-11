import { ProjectMembersTab } from "@/components/projects/project-members-tab"
import { useProjectDetail } from "@/pages/projects/project-detail-context"

export function ProjectMembersPage() {
  const { project } = useProjectDetail()
  return (
    <ProjectMembersTab
      key={`${project.id}-${project.updatedAt}`}
      projectId={project.id}
    />
  )
}
