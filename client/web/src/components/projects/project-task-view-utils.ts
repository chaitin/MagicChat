import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "@/components/projects/project-types"

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

export const projectTaskStatusDetails = {
  todo: {
    label: "待办",
    softClassName:
      "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    solidClassName: "bg-amber-600 text-white dark:bg-amber-700",
  },
  in_progress: {
    label: "进行中",
    softClassName:
      "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
    solidClassName: "bg-sky-600 text-white dark:bg-sky-700",
  },
  done: {
    label: "已完成",
    softClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    solidClassName: "bg-emerald-600 text-white dark:bg-emerald-700",
  },
  canceled: {
    label: "已取消",
    softClassName:
      "border-stone-200 bg-stone-50 text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100",
    solidClassName: "bg-stone-500 text-white dark:bg-stone-600",
  },
} satisfies Record<
  ProjectTaskStatus,
  { label: string; softClassName: string; solidClassName: string }
>

export function getProjectTaskBlockClassName(status: ProjectTaskStatus) {
  return projectTaskStatusDetails[status].solidClassName
}

export function getProjectTaskBlockHoverClassName(status: ProjectTaskStatus) {
  switch (status) {
    case "todo":
      return "hover:bg-amber-700 hover:text-white dark:hover:bg-amber-600 dark:hover:text-white"
    case "in_progress":
      return "hover:bg-sky-700 hover:text-white dark:hover:bg-sky-600 dark:hover:text-white"
    case "done":
      return "hover:bg-emerald-700 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white"
    case "canceled":
      return "hover:bg-stone-600 hover:text-white dark:hover:bg-stone-500 dark:hover:text-white"
  }
}

export const projectTaskPriorityLabels = {
  1: "低",
  2: "中",
  3: "高",
} satisfies Record<ProjectTaskPriority, string>

export function parseDateKey(value: string | null) {
  if (!value) {
    return null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return null
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  if (formatDateKey(date) !== value) {
    return null
  }
  return date
}

export function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

export function addCalendarDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

export function differenceInCalendarDays(date: Date, reference: Date) {
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const referenceUtc = Date.UTC(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate()
  )
  return Math.round((dateUtc - referenceUtc) / DAY_IN_MILLISECONDS)
}

export function getProjectTaskDateRange(task: ProjectTask) {
  const startDate = parseDateKey(task.startDate)
  const dueDate = parseDateKey(task.dueDate)
  if (!startDate && !dueDate) {
    return null
  }

  const firstDate = startDate ?? dueDate!
  const lastDate = dueDate ?? startDate!
  if (firstDate <= lastDate) {
    return { end: lastDate, start: firstDate }
  }
  return { end: firstDate, start: lastDate }
}

export function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date)
}
