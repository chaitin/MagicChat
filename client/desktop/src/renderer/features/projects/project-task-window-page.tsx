import { useEffect, useState } from "react"
import type { DesktopProjectTask, ProjectTaskAssignee } from "../../../shared/account-data"
import type { TaskWindowContext } from "../../../shared/task-window"
import { Button } from "@/components/ui/button"
import { WindowTitleBar } from "@/components/window-title-bar"
import { ProjectTaskDialog } from "./project-task-dialog"
import { ProjectTaskPanel } from "./project-task-panel"

type TaskWindowData = {
  context: TaskWindowContext
  task: DesktopProjectTask | null
}

export function ProjectTaskWindowPage() {
  const bridge = window.taskWindow!
  const [context, setContext] = useState<TaskWindowContext | null>(null)
  const [data, setData] = useState<TaskWindowData | null>(null)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [members, setMembers] = useState<ProjectTaskAssignee[]>([])
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState("")
  const [membersReload, setMembersReload] = useState(0)
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    let active = true
    setData(null)
    setError("")
    void (async () => {
      const context = await bridge.initialize()
      if (!active) return
      setContext(context)
      const task =
        context.view !== "project" && context.taskId
          ? await bridge.accountData.getProjectTask({
              targetId: context.targetId,
              projectId: context.projectId,
              taskId: context.taskId,
            })
          : null
      if (task && !task.ok) throw new Error(task.error.message)
      if (active) setData({ context, task: task?.data ?? null })
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "加载任务失败")
    })
    return () => {
      active = false
    }
  }, [bridge, reload])

  const projectView = context?.view === "project"
  const targetId = context?.targetId
  const projectId = context?.projectId
  useEffect(() => {
    if (projectView || !targetId || !projectId) return
    let active = true
    setMembersLoading(true)
    setMembersError("")
    void loadAllMembers(targetId, projectId)
      .then((items) => {
        if (active) setMembers(items)
      })
      .catch((reason: unknown) => {
        if (active) setMembersError(reason instanceof Error ? reason.message : "加载负责人列表失败")
      })
      .finally(() => {
        if (active) setMembersLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, projectView, membersReload])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    let theme: "system" | "light" | "dark" = "system"
    let changed = false
    let cancelled = false
    const update = () => {
      const dark = theme === "system" ? media.matches : theme === "dark"
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
      setResolvedTheme(dark ? "dark" : "light")
    }
    const unsubscribe = bridge.onThemeChanged((value) => {
      changed = true
      theme = value
      update()
    })
    update()
    void bridge
      .getTheme()
      .then((value) => {
        if (cancelled || changed) return
        theme = value
        update()
      })
      .catch(() => undefined)
    media.addEventListener("change", update)
    return () => {
      cancelled = true
      unsubscribe()
      media.removeEventListener("change", update)
    }
  }, [bridge])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <WindowTitleBar
        brandTitle={
          projectView
            ? context?.projectName
              ? context.projectName + " · 任务"
              : "项目任务"
            : data?.task?.title || (context ? (context.taskId ? "任务详情" : "创建任务") : "任务")
        }
        controls={bridge.windowControls}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {data && !projectView && (membersLoading || membersError) && (
          <div
            role={membersError ? "alert" : "status"}
            className="flex shrink-0 items-center gap-2 border-b px-5 py-2 text-sm text-muted-foreground"
          >
            <span>
              {membersError ? "负责人列表加载失败，其他任务操作仍可使用。" : "正在加载负责人列表…"}
            </span>
            {membersError && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMembersReload((current) => current + 1)}
              >
                重试
              </Button>
            )}
          </div>
        )}
        {error ? (
          <div className="flex flex-col items-center gap-3 p-6 text-sm">
            <p role="alert" className="text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => setReload((current) => current + 1)}>
              重新加载
            </Button>
          </div>
        ) : data?.context.view === "project" ? (
          <ProjectTaskPanel
            targetId={data.context.targetId}
            projectId={data.context.projectId}
            projectName={data.context.projectName}
            resolvedTheme={resolvedTheme}
            showOpenWindowButton={false}
          />
        ) : data ? (
          <div className="min-h-0 flex-1">
            <ProjectTaskDialog
              targetId={data.context.targetId}
              projectId={data.context.projectId}
              task={data.task}
              members={members}
              membersDisabled={membersLoading || Boolean(membersError)}
              resolvedTheme={resolvedTheme}
              onClose={() => void bridge.windowControls.close()}
              onChanged={() => bridge.notifyChanged()}
              onTaskSaved={(task) =>
                setData((current) => (current ? { ...current, task } : current))
              }
            />
          </div>
        ) : (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            正在加载任务…
          </p>
        )}
      </main>
    </div>
  )
}

async function loadAllMembers(targetId: string, projectId: string): Promise<ProjectTaskAssignee[]> {
  const items: ProjectTaskAssignee[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await window.taskWindow!.accountData.listProjectTaskAssignees({
      targetId,
      projectId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    if (!result.ok) throw new Error(result.error.message)
    items.push(...result.data.items)
    cursor = result.data.nextCursor
    if (cursor && (!result.data.items.length || seen.has(cursor)))
      throw new Error("项目成员分页格式不正确")
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items.filter((member) => member.status === "active")
}
