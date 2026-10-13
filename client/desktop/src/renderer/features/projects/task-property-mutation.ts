import type {
  DesktopProjectTask,
  ProjectTaskMutation,
  ProjectTaskPriority,
  ProjectTaskReminderInput,
  ProjectTaskStatus,
} from "../../../shared/account-data.ts"

export type TaskPropertyValues = {
  status: ProjectTaskStatus
  priority: ProjectTaskPriority
  assigneeUserId: string
  startDate: string
  dueDate: string
  reminder: ProjectTaskReminderInput | null
}

export function taskPropertyValues(task: DesktopProjectTask): TaskPropertyValues {
  const reminder = task.reminder
  return {
    status: task.status,
    priority: task.priority,
    assigneeUserId: task.assignee?.id ?? "",
    startDate: task.startDate ?? "",
    dueDate: task.dueDate ?? "",
    reminder: !reminder
      ? null
      : reminder.mode === "once"
        ? { mode: "once", at: reminder.at, timezone: reminder.timezone }
        : {
            mode: "recurring",
            frequency: reminder.frequency,
            time: reminder.time,
            timezone: reminder.timezone,
            ...(reminder.weekdays ? { weekdays: reminder.weekdays } : {}),
            ...(reminder.dayOfMonth !== undefined ? { dayOfMonth: reminder.dayOfMonth } : {}),
          },
  }
}

export function taskPropertyMutation<K extends keyof TaskPropertyValues>(
  current: TaskPropertyValues,
  key: K,
  value: TaskPropertyValues[K],
): ProjectTaskMutation | null {
  if (JSON.stringify(current[key]) === JSON.stringify(value)) return null
  const next = { ...current, [key]: value }
  if (next.startDate && next.dueDate && next.startDate > next.dueDate) {
    throw new Error("开始日期不能晚于截止日期")
  }
  if (key === "startDate" || key === "dueDate" || key === "assigneeUserId") {
    return { [key]: value || null }
  }
  return { [key]: value }
}
