export type ProjectTaskStatus = "todo" | "in_progress" | "done" | "canceled"

export type ProjectTaskPriority = 1 | 2 | 3

export type ProjectTaskUser = {
  avatar: string
  id: string
  name: string
  nickname: string
}

export type ProjectTask = {
  assignee: ProjectTaskUser | null
  canceledAt: string | null
  completedAt: string | null
  createdAt: string
  creator: ProjectTaskUser
  description: string
  dueDate: string | null
  id: string
  labels: string[]
  priority: ProjectTaskPriority
  projectId: string
  startDate: string | null
  status: ProjectTaskStatus
  title: string
  updatedAt: string
}
