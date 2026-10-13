import { AuthFailure, isRecord } from "../../shared/auth.ts"
import type {
  AddProjectTaskCommentInput,
  CreateProjectTaskInput,
  DesktopProjectTask,
  ListProjectTaskActivitiesInput,
  ListProjectMembersInput,
  ListProjectTasksInput,
  ProjectMember,
  ProjectTaskAssignee,
  ProjectPage,
  ProjectTargetInput,
  ProjectTaskActivity,
  ProjectTaskMutation,
  ProjectTaskReminder,
  ProjectTaskReminderInput,
  ProjectTaskTargetInput,
  ProjectTaskUser,
  UpdateProjectTaskInput,
} from "../../shared/account-data"
import type { AuthenticatedClient } from "./authenticated-client"

const statuses = new Set(["todo", "in_progress", "done", "canceled"])
const reminderStates = new Set(["scheduled", "paused", "fired", "expired"])

export class ProjectTaskManager {
  private readonly client: AuthenticatedClient

  constructor(client: AuthenticatedClient) {
    this.client = client
  }

  async list(input: ListProjectTasksInput): Promise<ProjectPage<DesktopProjectTask>> {
    const path = taskPath(input)
    const query = new URLSearchParams()
    if (input.cursor) query.set("cursor", checkedId(input.cursor, "分页游标", 2048))
    if (input.limit !== undefined) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) invalidInput()
      query.set("limit", String(input.limit))
    }
    if (input.keyword) query.set("keyword", checkedText(input.keyword, "关键词", 256))
    if (input.statuses?.length) {
      if (!Array.isArray(input.statuses) || input.statuses.some((item) => !statuses.has(item)))
        invalidInput()
      query.set("status", input.statuses.join(","))
    }
    if (input.priorities?.length) {
      if (!Array.isArray(input.priorities) || input.priorities.some((item) => !isPriority(item)))
        invalidInput()
      query.set("priority", input.priorities.join(","))
    }
    if (input.assigneeUserIds?.length) {
      if (!Array.isArray(input.assigneeUserIds) || input.assigneeUserIds.length > 100)
        invalidInput()
      query.set(
        "assignee_user_id",
        input.assigneeUserIds.map((id) => checkedId(id, "负责人")).join(","),
      )
    }
    const data = await this.client.get(`${path}${query.size ? `?${query}` : ""}`)
    return parsePage(data, "tasks", (value) => parseTask(value, input.projectId))
  }

  async get(input: ProjectTaskTargetInput): Promise<DesktopProjectTask> {
    return parseTask(await this.client.get(taskItemPath(input)), input.projectId, input.taskId)
  }

  async create(input: CreateProjectTaskInput): Promise<DesktopProjectTask> {
    const path = taskPath(input)
    const body = taskBody(input, true)
    return parseTask(await this.client.post(path, body), input.projectId)
  }

  async update(input: UpdateProjectTaskInput): Promise<DesktopProjectTask> {
    const path = taskItemPath(input)
    const body = taskBody(input, false)
    if (Object.keys(body).length === 0) invalidInput()
    return parseTask(await this.client.patch(path, body), input.projectId, input.taskId)
  }

  async delete(input: ProjectTaskTargetInput): Promise<string> {
    const data = await this.client.delete(taskItemPath(input))
    if (!isRecord(data) || data.task_id !== input.taskId) invalidResponse("删除任务")
    return input.taskId
  }

  async listMembers(input: ListProjectMembersInput): Promise<ProjectPage<ProjectMember>> {
    const projectId = checkedId(input?.projectId, "项目")
    const query = new URLSearchParams({ limit: String(input.limit ?? 100) })
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
    )
      invalidInput()
    if (input.cursor) query.set("cursor", checkedId(input.cursor, "分页游标", 2048))
    const data = await this.client.get(
      `/api/client/projects/${encodeURIComponent(projectId)}/members?${query}`,
    )
    return parsePage(data, "members", parseMember)
  }

  async listAssignees(input: ListProjectMembersInput): Promise<ProjectPage<ProjectTaskAssignee>> {
    const page = await this.listMembers(input)
    const userIds = [...new Set(page.items.map((member) => member.id))]
    const profiles = new Map<
      string,
      { name: string; nickname: string; email: string; phone: string }
    >()
    if (userIds.length) {
      const data = await this.client.post("/api/client/users/resolve", { user_ids: userIds })
      if (!isRecord(data) || !Array.isArray(data.users)) invalidResponse("项目成员资料")
      for (const user of data.users) {
        if (!isRecord(user) || typeof user.id !== "string" || !user.id)
          invalidResponse("项目成员资料")
        if (userIds.includes(user.id))
          profiles.set(user.id, {
            name: optionalString(user.name),
            nickname: optionalString(user.nickname),
            email: optionalString(user.email),
            phone: optionalString(user.phone),
          })
      }
    }
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((member) => {
        const profile = profiles.get(member.id)
        return {
          ...member,
          name: profile?.name ?? "",
          nickname: profile?.nickname ?? "",
          phone: profile?.phone ?? "",
          email: profile?.email ?? "",
          displayName:
            profile?.nickname ||
            profile?.name ||
            (member.displayName === member.id ? "未知成员" : member.displayName),
        }
      }),
    }
  }

  async listActivities(
    input: ListProjectTaskActivitiesInput,
  ): Promise<ProjectPage<ProjectTaskActivity>> {
    const path = taskItemPath(input)
    const query = new URLSearchParams({ limit: String(input.limit ?? 20) })
    if (
      input.limit !== undefined &&
      (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
    )
      invalidInput()
    if (input.cursor) query.set("cursor", checkedId(input.cursor, "分页游标", 2048))
    const data = await this.client.get(`${path}/activities?${query}`)
    return parsePage(data, "activities", (value) => parseActivity(value, input))
  }

  async addComment(input: AddProjectTaskCommentInput): Promise<ProjectTaskActivity> {
    const path = taskItemPath(input)
    const content = checkedText(input.content, "评论", 5000).trim()
    if (!content) invalidInput()
    return parseActivity(await this.client.post(`${path}/comments`, { content }), input)
  }
}

function taskPath(input: ProjectTargetInput): string {
  return `/api/client/projects/${encodeURIComponent(checkedId(input?.projectId, "项目"))}/tasks`
}

function taskItemPath(input: ProjectTaskTargetInput): string {
  return `${taskPath(input)}/${encodeURIComponent(checkedId(input?.taskId, "任务"))}`
}

function checkedId(value: unknown, label: string, max = 128): string {
  if (typeof value !== "string" || !value || value.length > max) {
    throw new AuthFailure("invalid_input", `${label}参数不正确`)
  }
  return value
}

function checkedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new AuthFailure("invalid_input", `${label}内容不正确`)
  }
  return value
}

function invalidInput(): never {
  throw new AuthFailure("invalid_input", "任务参数不正确")
}

function invalidResponse(label: string): never {
  throw new AuthFailure("invalid_response", `${label}响应格式不正确`)
}

function taskBody(input: ProjectTaskMutation, creating: boolean): Record<string, unknown> {
  if (!isRecord(input)) invalidInput()
  const body: Record<string, unknown> = {}
  if (input.title !== undefined) {
    const title = checkedText(input.title, "标题", 240).trim()
    if (!title) invalidInput()
    body.title = title
  } else if (creating) invalidInput()
  if (input.description !== undefined)
    body.description = checkedText(input.description, "描述", 10000)
  if (input.status !== undefined) {
    if (!statuses.has(input.status)) invalidInput()
    body.status = input.status
  }
  if (input.priority !== undefined) {
    if (!isPriority(input.priority)) invalidInput()
    body.priority = input.priority
  }
  if (input.assigneeUserId !== undefined)
    body.assignee_user_id =
      input.assigneeUserId === null ? null : checkedId(input.assigneeUserId, "负责人")
  for (const [key, value] of [
    ["start_date", input.startDate],
    ["due_date", input.dueDate],
  ] as const) {
    if (value !== undefined) {
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)))
        invalidInput()
      body[key] = value
    }
  }
  if (input.labels !== undefined) {
    if (
      !Array.isArray(input.labels) ||
      input.labels.length > 20 ||
      input.labels.some((label) => typeof label !== "string" || !label.trim() || label.length > 64)
    )
      invalidInput()
    body.labels = input.labels
  }
  if (input.reminder !== undefined)
    body.reminder = input.reminder === null ? null : serializeReminder(input.reminder)
  return body
}

function serializeReminder(input: ProjectTaskReminderInput): Record<string, unknown> {
  if (!isRecord(input) || input.timezone !== "Asia/Shanghai") invalidInput()
  if (input.mode === "once") {
    if (typeof input.at !== "string" || !Number.isFinite(Date.parse(input.at))) invalidInput()
    return { mode: "once", at: input.at, timezone: input.timezone }
  }
  if (
    input.mode !== "recurring" ||
    !["daily", "weekly", "monthly"].includes(input.frequency) ||
    typeof input.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
  )
    invalidInput()
  const value: Record<string, unknown> = {
    mode: "recurring",
    frequency: input.frequency,
    time: input.time,
    timezone: input.timezone,
  }
  if (input.frequency === "weekly") {
    if (
      !Array.isArray(input.weekdays) ||
      !input.weekdays.length ||
      input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    )
      invalidInput()
    value.weekdays = input.weekdays
  }
  if (input.frequency === "monthly") {
    if (
      !Number.isInteger(input.dayOfMonth) ||
      (input.dayOfMonth ?? 0) < 1 ||
      (input.dayOfMonth ?? 0) > 31
    )
      invalidInput()
    value.day_of_month = input.dayOfMonth
  }
  return value
}

function parsePage<T>(
  data: unknown,
  key: "tasks" | "members" | "activities",
  parse: (value: unknown) => T,
): ProjectPage<T> {
  if (
    !isRecord(data) ||
    !Array.isArray(data[key]) ||
    (data.next_cursor !== null &&
      data.next_cursor !== undefined &&
      (typeof data.next_cursor !== "string" || !data.next_cursor))
  )
    invalidResponse("列表")
  return { items: data[key].map(parse), nextCursor: data.next_cursor ?? null }
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") invalidResponse("任务")
  return value
}

function parseUser(value: unknown): ProjectTaskUser {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) invalidResponse("任务用户")
  return {
    id: value.id,
    name: optionalString(value.name),
    nickname: optionalString(value.nickname),
    avatar: optionalString(value.avatar),
  }
}

function isPriority(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
}

function parseReminder(value: unknown): ProjectTaskReminder | null {
  if (value === null || value === undefined) return null
  if (
    !isRecord(value) ||
    value.timezone !== "Asia/Shanghai" ||
    typeof value.state !== "string" ||
    !reminderStates.has(value.state) ||
    (value.last_processed_at != null && typeof value.last_processed_at !== "string") ||
    (value.next_trigger_at != null && typeof value.next_trigger_at !== "string")
  )
    invalidResponse("任务提醒")
  const runtime = {
    state: value.state as ProjectTaskReminder["state"],
    lastProcessedAt: nullableString(value.last_processed_at),
    nextTriggerAt: nullableString(value.next_trigger_at),
  }
  if (value.mode === "once") {
    if (typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)))
      invalidResponse("任务提醒")
    return { mode: "once", timezone: "Asia/Shanghai", at: value.at, ...runtime }
  }
  if (
    value.mode !== "recurring" ||
    typeof value.frequency !== "string" ||
    !["daily", "weekly", "monthly"].includes(value.frequency) ||
    typeof value.time !== "string"
  )
    invalidResponse("任务提醒")
  const reminder: ProjectTaskReminder = {
    mode: "recurring",
    frequency: value.frequency as "daily" | "weekly" | "monthly",
    timezone: "Asia/Shanghai",
    time: value.time,
    ...runtime,
  }
  if (reminder.frequency === "weekly") {
    if (!Array.isArray(value.weekdays)) invalidResponse("任务提醒")
    reminder.weekdays = value.weekdays.filter(
      (day): day is number => Number.isInteger(day) && day >= 1 && day <= 7,
    )
  }
  if (reminder.frequency === "monthly") {
    if (!Number.isInteger(value.day_of_month)) invalidResponse("任务提醒")
    reminder.dayOfMonth = value.day_of_month as number
  }
  return reminder
}

function parseTask(value: unknown, projectId: string, taskId?: string): DesktopProjectTask {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.project_id !== projectId ||
    (taskId && value.id !== taskId) ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    !isPriority(value.priority) ||
    !Array.isArray(value.labels) ||
    value.labels.some((label) => typeof label !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  )
    invalidResponse("任务")
  return {
    id: value.id,
    projectId,
    title: value.title,
    description: value.description,
    status: value.status as DesktopProjectTask["status"],
    priority: value.priority,
    assignee: value.assignee ? parseUser(value.assignee) : null,
    creator: parseUser(value.creator),
    startDate: nullableString(value.start_date),
    dueDate: nullableString(value.due_date),
    labels: value.labels,
    reminder: parseReminder(value.reminder),
    completedAt: nullableString(value.completed_at),
    canceledAt: nullableString(value.canceled_at),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  }
}

function parseMember(value: unknown): ProjectMember {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    (value.role !== "owner" && value.role !== "member")
  )
    invalidResponse("项目成员")
  return {
    id: value.id,
    displayName:
      optionalString(value.display_name) ||
      optionalString(value.nickname) ||
      optionalString(value.name) ||
      value.id,
    avatar: optionalString(value.avatar),
    email: optionalString(value.email),
    role: value.role,
    status: optionalString(value.status),
  }
}

function parseActivity(value: unknown, input: ProjectTaskTargetInput): ProjectTaskActivity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.project_id !== input.projectId ||
    value.task_id !== input.taskId ||
    typeof value.type !== "string" ||
    !["created", "updated", "commented"].includes(value.type) ||
    typeof value.content !== "string" ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.changes)
  )
    invalidResponse("任务动态")
  const changes = value.changes.map((change) => {
    if (
      !isRecord(change) ||
      typeof change.field !== "string" ||
      !("from" in change) ||
      !("to" in change)
    )
      invalidResponse("任务动态")
    return { field: change.field, from: change.from, to: change.to }
  })
  return {
    id: value.id,
    projectId: input.projectId,
    taskId: input.taskId,
    type: value.type as ProjectTaskActivity["type"],
    actor: parseUser(value.actor),
    content: value.content,
    changes,
    createdAt: value.created_at,
  }
}
