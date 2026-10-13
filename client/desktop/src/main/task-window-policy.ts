import { ACCOUNT_DATA_CHANNELS } from "../shared/account-data.ts"
import { AuthFailure, isRecord } from "../shared/auth.ts"
import type { TaskWindowContext, TaskWindowOpenInput } from "../shared/task-window"

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128

export function parseTaskWindowOpenInput(input: unknown): TaskWindowContext {
  if (
    !isRecord(input) ||
    !validId(input.targetId) ||
    !validId(input.projectId) ||
    (input.taskId !== undefined && !validId(input.taskId))
  ) {
    throw new AuthFailure("invalid_task_window", "任务窗口参数不正确")
  }
  return {
    targetId: input.targetId,
    projectId: input.projectId,
    taskId: (input as TaskWindowOpenInput).taskId ?? null,
  }
}

const projectOperations = new Set<string>([
  ACCOUNT_DATA_CHANNELS.listProjectMembers,
  ACCOUNT_DATA_CHANNELS.listProjectTaskAssignees,
  ACCOUNT_DATA_CHANNELS.resolveUserNames,
])
const detailOperations = new Set<string>([
  ACCOUNT_DATA_CHANNELS.getProjectTask,
  ACCOUNT_DATA_CHANNELS.updateProjectTask,
  ACCOUNT_DATA_CHANNELS.deleteProjectTask,
  ACCOUNT_DATA_CHANNELS.listProjectTaskActivities,
  ACCOUNT_DATA_CHANNELS.addProjectTaskComment,
])

export function assertTaskWindowAccountRequest(
  context: TaskWindowContext,
  channel: string,
  input: unknown,
) {
  if (!isRecord(input) || input.targetId !== context.targetId) {
    throw new AuthFailure("untrusted_sender", "任务窗口请求来源不受信任")
  }
  if (
    channel === ACCOUNT_DATA_CHANNELS.getAvatar ||
    channel === ACCOUNT_DATA_CHANNELS.invalidateAvatar
  ) {
    if (input.type !== "user" || !validId(input.id)) {
      throw new AuthFailure("untrusted_sender", "任务窗口只能读取用户头像")
    }
    return
  }
  if (channel === ACCOUNT_DATA_CHANNELS.resolveUserNames) {
    if (!Array.isArray(input.userIds) || input.userIds.length > 100) {
      throw new AuthFailure("invalid_user_ids", "用户列表不正确")
    }
    return
  }
  if (input.projectId !== context.projectId) {
    throw new AuthFailure("untrusted_sender", "任务窗口请求来源不受信任")
  }
  if (projectOperations.has(channel)) return
  if (channel === ACCOUNT_DATA_CHANNELS.createProjectTask && context.taskId === null) return
  if (detailOperations.has(channel) && context.taskId && input.taskId === context.taskId) return
  throw new AuthFailure("untrusted_sender", "任务窗口请求来源不受信任")
}
