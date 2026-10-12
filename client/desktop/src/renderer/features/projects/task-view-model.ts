import type {
  DesktopProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "../../../shared/account-data"

export const taskStatuses: ProjectTaskStatus[] = ["todo", "in_progress", "done", "canceled"]
export const taskStatusLabels: Record<ProjectTaskStatus, string> = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
  canceled: "已取消",
}
export const taskPriorities: ProjectTaskPriority[] = [3, 2, 1]
export const taskPriorityLabels: Record<ProjectTaskPriority, string> = {
  1: "低",
  2: "中",
  3: "高",
}

export function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

export function parseDateKey(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return formatDateKey(date) === value ? date : null
}

export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

export function daysBetween(date: Date, first: Date): number {
  return Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) /
      86_400_000,
  )
}

export function taskDateRange(task: DesktopProjectTask): { start: Date; end: Date } | null {
  const start = parseDateKey(task.startDate)
  const end = parseDateKey(task.dueDate)
  if (!start && !end) return null
  const first = start ?? end!
  const last = end ?? start!
  return first <= last ? { start: first, end: last } : { start: last, end: first }
}

export function calendarTasksOnDate(tasks: DesktopProjectTask[], date: Date): DesktopProjectTask[] {
  const key = formatDateKey(date)
  return tasks.filter((task) => {
    const range = taskDateRange(task)
    return range && formatDateKey(range.start) <= key && key <= formatDateKey(range.end)
  })
}

export function ganttSpan(
  task: DesktopProjectTask,
  origin: Date,
): { left: number; width: number } | null {
  const range = taskDateRange(task)
  if (!range) return null
  return {
    left: daysBetween(range.start, origin),
    width: daysBetween(range.end, range.start) + 1,
  }
}
