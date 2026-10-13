import type { AccountDataBridge } from "./account-data"
import type { AuthResult } from "./auth"
import type { DesktopBridge, ThemePreference } from "./desktop"

export type TaskWindowContext = { targetId: string; projectId: string; taskId: string | null }
export type TaskWindowOpenInput = Omit<TaskWindowContext, "taskId"> & { taskId?: string }
export type TaskWindowChange = Pick<TaskWindowContext, "targetId" | "projectId">

export const TASK_WINDOW_CHANNELS = {
  open: "desktop-next:v1:task-window-open",
  initialize: "desktop-next:v1:task-window-initialize",
  changed: "desktop-next:v1:task-window-changed",
  notifyChanged: "desktop-next:v1:task-window-notify-changed",
  getTheme: "desktop-next:v1:task-window-get-theme",
  themeChanged: "desktop-next:v1:task-window-theme-changed",
} as const

export interface TaskWindowBridge {
  initialize(): Promise<TaskWindowContext>
  notifyChanged(): Promise<void>
  getTheme(): Promise<ThemePreference>
  onThemeChanged(callback: (theme: ThemePreference) => void): () => void
  readonly windowControls: Omit<DesktopBridge["windowControls"], "quit">
  readonly accountData: Pick<
    AccountDataBridge,
    | "getProjectTask"
    | "createProjectTask"
    | "updateProjectTask"
    | "deleteProjectTask"
    | "listProjectMembers"
    | "listProjectTaskAssignees"
    | "listProjectTaskActivities"
    | "addProjectTaskComment"
    | "uploadProjectTaskImage"
    | "readProjectTaskImage"
    | "listConversations"
    | "getContacts"
    | "openContactConversation"
    | "sendRichMessage"
    | "resolveUserNames"
  >
}

export interface TaskWindowOpener {
  open(input: TaskWindowOpenInput): Promise<AuthResult<null>>
  onChanged(callback: (change: TaskWindowChange) => void): () => void
}
