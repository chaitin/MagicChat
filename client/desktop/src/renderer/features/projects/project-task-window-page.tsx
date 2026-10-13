import { useEffect, useState } from "react"
import type { DesktopProjectTask, ProjectTaskAssignee } from "../../../shared/account-data"
import type { TaskWindowContext } from "../../../shared/task-window"
import { Button } from "@/components/ui/button"
import { WindowTitleBar } from "@/components/window-title-bar"
import { ProjectTaskDialog } from "./project-task-dialog"

type TaskWindowData = {
  context: TaskWindowContext
  task: DesktopProjectTask | null
  members: ProjectTaskAssignee[]
}

export function ProjectTaskWindowPage() {
  const bridge = window.taskWindow!
  const [data, setData] = useState<TaskWindowData | null>(null)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    let active = true
    setError("")
    void (async () => {
      const context = await bridge.initialize()
      const [task, members] = await Promise.all([
        context.taskId
          ? bridge.accountData.getProjectTask({
              targetId: context.targetId,
              projectId: context.projectId,
              taskId: context.taskId,
            })
          : null,
        loadAllMembers(context.targetId, context.projectId),
      ])
      if (task && !task.ok) throw new Error(task.error.message)
      if (active) setData({ context, task: task?.data ?? null, members })
    })().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "加载任务失败")
    })
    return () => {
      active = false
    }
  }, [bridge, reload])

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
        brandTitle={data?.task?.title || (data?.context.taskId ? "任务详情" : "创建任务")}
        controls={bridge.windowControls}
      />
      <main className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div className="flex flex-col items-center gap-3 p-6 text-sm">
            <p role="alert" className="text-destructive">
              {error}
            </p>
            <Button variant="outline" onClick={() => setReload((current) => current + 1)}>
              重新加载
            </Button>
          </div>
        ) : data ? (
          <ProjectTaskDialog
            targetId={data.context.targetId}
            projectId={data.context.projectId}
            task={data.task}
            members={data.members}
            resolvedTheme={resolvedTheme}
            onClose={() => void bridge.windowControls.close()}
            onChanged={() => bridge.notifyChanged()}
            onTaskSaved={(task) => setData((current) => (current ? { ...current, task } : current))}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">正在加载任务…</p>
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
