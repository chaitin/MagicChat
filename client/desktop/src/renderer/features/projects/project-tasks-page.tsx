import { ProjectTaskPanel, type ProjectTaskPanelProps } from "./project-task-panel"

export function ProjectTasksPage(props: Omit<ProjectTaskPanelProps, "showOpenWindowButton">) {
  return <ProjectTaskPanel {...props} />
}
