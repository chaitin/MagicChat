import { ProjectDocumentsTab } from "@/components/projects/project-documents-tab"
import { useProjectDetail } from "@/pages/projects/project-detail-context"

export function ProjectDocumentsPage() {
  const { project } = useProjectDetail()
  return <ProjectDocumentsTab key={project.id} projectId={project.id} />
}
