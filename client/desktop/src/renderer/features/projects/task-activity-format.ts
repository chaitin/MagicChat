import type { ProjectTaskActivity } from "../../../shared/account-data.ts"
import { taskPriorityLabels, taskStatusLabels } from "./task-view-model.ts"

type TaskChange = ProjectTaskActivity["changes"][number]
const fieldLabels: Record<string, string> = {
  title: "标题",
  description: "详细说明",
  status: "状态",
  priority: "优先级",
  assignee: "负责人",
  start_date: "开始日期",
  due_date: "截止日期",
  labels: "标签",
  reminder: "任务提醒",
}

export function taskActivityChangeText(
  change: TaskChange,
  userNames: ReadonlyMap<string, string>,
): string {
  const label = fieldLabels[change.field] ?? change.field
  // 后端只记录说明被修改，不保留正文前后值。
  if (change.field === "description") return "修改了详细说明"
  return `修改了${label}：从「${changeValue(change.field, change.from, userNames)}」改为「${changeValue(change.field, change.to, userNames)}」`
}

function changeValue(
  field: string,
  value: unknown,
  userNames: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined || value === "") {
    if (field === "assignee") return "未分配"
    if (field === "labels") return "无标签"
    if (field === "reminder") return "不提醒"
    return "未设置"
  }
  if (field === "status" && typeof value === "string") {
    return taskStatusLabels[value as keyof typeof taskStatusLabels] ?? value
  }
  if (field === "priority" && (typeof value === "number" || typeof value === "string")) {
    return taskPriorityLabels[Number(value) as keyof typeof taskPriorityLabels] ?? String(value)
  }
  if (field === "assignee" && typeof value === "string") return userNames.get(value) || value
  if (field === "labels" && Array.isArray(value)) {
    return (
      value
        .filter((label): label is string => typeof label === "string" && !!label.trim())
        .join("、") || "无标签"
    )
  }
  if (field === "reminder") return reminderValue(value)
  return plainValue(value)
}

function reminderValue(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return plainValue(value)
  const reminder = value as Record<string, unknown>
  const timezone = typeof reminder.timezone === "string" ? reminder.timezone : "Asia/Shanghai"
  const zoneLabel = timezone === "Asia/Shanghai" ? "北京时间" : timezone
  if (reminder.mode === "once" && typeof reminder.at === "string") {
    const date = new Date(reminder.at)
    if (Number.isNaN(date.getTime())) return plainValue(value)
    try {
      return `一次性 · ${date.toLocaleString("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}（${zoneLabel}）`
    } catch {
      return plainValue(value)
    }
  }
  if (reminder.mode !== "recurring" || typeof reminder.time !== "string") return plainValue(value)
  let cycle: string
  if (reminder.frequency === "daily") cycle = "每天"
  else if (reminder.frequency === "weekly" && Array.isArray(reminder.weekdays)) {
    const days = reminder.weekdays.filter(
      (day): day is number =>
        typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7,
    )
    cycle = `每周${days.map((day) => ["一", "二", "三", "四", "五", "六", "日"][day - 1]).join("、")}`
  } else if (reminder.frequency === "monthly" && typeof reminder.day_of_month === "number")
    cycle = `每月 ${reminder.day_of_month} 日`
  else return plainValue(value)
  return `${cycle} ${reminder.time}（${zoneLabel}）`
}

function plainValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value)
  return JSON.stringify(value) ?? "未设置"
}
