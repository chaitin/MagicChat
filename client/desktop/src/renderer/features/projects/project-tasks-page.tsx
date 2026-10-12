import { useEffect, useState, type FormEvent } from "react"
import {
  CalendarDays,
  ChartGantt,
  Check,
  ChevronDown,
  Columns3,
  ListFilterIcon,
  ListTodo,
  Plus,
  RefreshCw,
} from "lucide-react"
import type {
  DesktopProjectTask,
  ListProjectTasksInput,
  ProjectMember,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "../../../shared/account-data"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button as BeButton } from "@/components/motion/button/base"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ProjectTaskDialog } from "./project-task-dialog"
import {
  TaskBoardView,
  TaskCalendarView,
  TaskGanttView,
  TaskListView,
  TaskPriorityIcon,
  TaskStatusIcon,
} from "./project-task-views"
import {
  withResolvedMemberNames,
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
} from "./task-view-model"

type TaskView = "list" | "board" | "calendar" | "gantt"
type TaskFilters = {
  keyword: string
  statuses: ProjectTaskStatus[]
  priorities: ProjectTaskPriority[]
}
const views: { id: TaskView; label: string; icon: typeof ListTodo }[] = [
  { id: "list", label: "任务列表", icon: ListTodo },
  { id: "board", label: "看板", icon: Columns3 },
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "gantt", label: "甘特图", icon: ChartGantt },
]
const defaultFilters: TaskFilters = {
  keyword: "",
  statuses: [],
  priorities: [],
}

function storedTaskView(): TaskView {
  try {
    const value = window.localStorage.getItem("project-task-view")
    return views.find((view) => view.id === value)?.id ?? "list"
  } catch {
    return "list"
  }
}

export function ProjectTasksPage({ targetId, projectId }: { targetId: string; projectId: string }) {
  const { showToast } = useAnimatedToast()
  const [view, setView] = useState<TaskView>(storedTaskView)
  const activeViewDetails = views.find((item) => item.id === view) ?? views[0]
  const ActiveViewIcon = activeViewDetails.icon
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<TaskFilters>(defaultFilters)
  const [tasks, setTasks] = useState<DesktopProjectTask[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [activeTask, setActiveTask] = useState<DesktopProjectTask | null | "new">(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    void loadAllTasks({ targetId, projectId, ...appliedFilters })
      .then((items) => {
        if (active) setTasks(items)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "加载任务列表失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, appliedFilters, reload])

  useEffect(() => {
    let active = true
    void loadAllMembers(targetId, projectId)
      .then((items) => {
        if (active) setMembers(items.filter((member) => member.status === "active"))
      })
      .catch((reason: unknown) => {
        if (active) {
          showToast({
            status: "error",
            title: reason instanceof Error ? reason.message : "加载项目成员失败",
          })
        }
      })
    return () => {
      active = false
    }
  }, [targetId, projectId])

  async function movePriority(task: DesktopProjectTask, priority: ProjectTaskPriority) {
    if (task.priority === priority) return
    setTasks((current) =>
      current.map((item) => (item.id === task.id ? { ...item, priority } : item)),
    )
    try {
      const result = await window.desktop!.accountData.updateProjectTask({
        targetId,
        projectId,
        taskId: task.id,
        priority,
      })
      if (!result.ok) throw new Error(result.error.message)
      setReload((current) => current + 1)
    } catch (reason) {
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, priority: task.priority } : item)),
      )
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : "更新任务优先级失败",
      })
    }
  }

  async function moveStatus(task: DesktopProjectTask, status: ProjectTaskStatus) {
    if (task.status === status) return
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status } : item)))
    try {
      const result = await window.desktop!.accountData.updateProjectTask({
        targetId,
        projectId,
        taskId: task.id,
        status,
      })
      if (!result.ok) throw new Error(result.error.message)
      setReload((current) => current + 1)
    } catch (reason) {
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, status: task.status } : item)),
      )
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : "更新任务状态失败",
      })
    }
  }

  function changeFilter<K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) {
    const next = { ...filters, [key]: value }
    setFilters(next)
    if (key !== "keyword") setAppliedFilters({ ...next, keyword: next.keyword.trim() })
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedFilters({ ...filters, keyword: filters.keyword.trim() })
  }

  function changeView(next: TaskView) {
    setView(next)
    try {
      window.localStorage.setItem("project-task-view", next)
    } catch {
      /* 仍可切换视图 */
    }
  }

  return (
    <section
      className="@container/task-pane flex min-h-0 min-w-0 flex-1 flex-col bg-card"
      aria-label="项目任务"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div
          role="group"
          aria-label="任务视图"
          className="flex shrink-0 items-center gap-1 @max-[549px]/task-pane:hidden"
        >
          {views.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={view === id ? "secondary" : "ghost"}
              aria-pressed={view === id}
              onClick={() => changeView(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BeButton
              type="button"
              variant="outline"
              size="sm"
              pressScale={1}
              whileHover={{ scale: 1 }}
              aria-label={`切换任务视图，当前：${activeViewDetails.label}`}
              className="hidden shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-4 @max-[549px]/task-pane:inline-flex"
            >
              <ActiveViewIcon />
              {activeViewDetails.label}
              <ChevronDown />
            </BeButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {views.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem
                key={id}
                aria-current={view === id ? "true" : undefined}
                onSelect={() => changeView(id)}
              >
                <Icon />
                {label}
                {view === id && <Check className="ml-auto" aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex shrink-0 items-center gap-2">
          <form className="shrink-0 @max-[779px]/task-pane:hidden" onSubmit={search}>
            <Input
              aria-label="搜索任务"
              placeholder="搜索任务"
              value={filters.keyword}
              onChange={(event) => changeFilter("keyword", event.target.value)}
              className="w-36"
            />
          </form>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="@max-[779px]/task-pane:hidden"
              >
                <ListFilterIcon />
                筛选
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48" align="end">
              <DropdownMenuLabel>状态</DropdownMenuLabel>
              {taskStatuses.map((status) => (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={filters.statuses.includes(status)}
                  className="cursor-pointer hover:bg-foreground/10 focus:bg-foreground/10 data-highlighted:bg-foreground/10"
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    changeFilter(
                      "statuses",
                      filters.statuses.includes(status)
                        ? filters.statuses.filter((item) => item !== status)
                        : [...filters.statuses, status],
                    )
                  }
                >
                  <TaskStatusIcon status={status} />
                  {taskStatusLabels[status]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>优先级</DropdownMenuLabel>
              {taskPriorities.map((priority) => (
                <DropdownMenuCheckboxItem
                  key={priority}
                  checked={filters.priorities.includes(priority)}
                  className="cursor-pointer hover:bg-foreground/10 focus:bg-foreground/10 data-highlighted:bg-foreground/10"
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    changeFilter(
                      "priorities",
                      filters.priorities.includes(priority)
                        ? filters.priorities.filter((item) => item !== priority)
                        : [...filters.priorities, priority],
                    )
                  }
                >
                  <TaskPriorityIcon priority={priority} />
                  {taskPriorityLabels[priority]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="刷新任务"
            onClick={() => setReload((current) => current + 1)}
          >
            <RefreshCw />
          </Button>
          <Button type="button" size="sm" onClick={() => setActiveTask("new")}>
            <Plus />
            创建任务
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          <RefreshCw className="mr-2 size-4 animate-spin" />
          正在加载任务
        </div>
      ) : error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive">
          <p role="alert">{error}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setReload((current) => current + 1)}
          >
            重新加载
          </Button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {hasFilters(appliedFilters) ? "没有匹配的任务" : "暂无任务"}
        </div>
      ) : view === "board" ? (
        <TaskBoardView
          tasks={tasks}
          onOpen={setActiveTask}
          onMove={(task, status) => void moveStatus(task, status)}
        />
      ) : (
        <ScrollArea
          type="hover"
          className={cn("min-h-0 min-w-0 flex-1", view === "gantt" && "bg-muted/10")}
          viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full!"
        >
          {view === "list" && (
            <TaskListView
              tasks={tasks}
              onOpen={setActiveTask}
              onMove={(task, status) => void moveStatus(task, status)}
              onPriorityChange={(task, priority) => void movePriority(task, priority)}
            />
          )}
          {view === "calendar" && <TaskCalendarView tasks={tasks} onOpen={setActiveTask} />}
          {view === "gantt" && <TaskGanttView tasks={tasks} onOpen={setActiveTask} />}
        </ScrollArea>
      )}
      {activeTask && (
        <ProjectTaskDialog
          key={activeTask === "new" ? "new" : activeTask.id}
          targetId={targetId}
          projectId={projectId}
          task={activeTask === "new" ? null : activeTask}
          members={members}
          onClose={() => setActiveTask(null)}
          onChanged={async () => {
            setReload((current) => current + 1)
          }}
        />
      )}
    </section>
  )
}

function hasFilters(filters: TaskFilters) {
  return Boolean(filters.keyword || filters.priorities.length || filters.statuses.length)
}

async function loadAllTasks(input: ListProjectTasksInput): Promise<DesktopProjectTask[]> {
  const items: DesktopProjectTask[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await window.desktop!.accountData.listProjectTasks({
      ...input,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    if (!result.ok) throw new Error(result.error.message)
    items.push(...result.data.items)
    cursor = result.data.nextCursor
    if (cursor && (!result.data.items.length || seen.has(cursor)))
      throw new Error("任务列表分页格式不正确")
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}

async function loadAllMembers(targetId: string, projectId: string): Promise<ProjectMember[]> {
  const items: ProjectMember[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await window.desktop!.accountData.listProjectMembers({
      targetId,
      projectId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    if (!result.ok) throw new Error(result.error.message)
    const unresolvedIds = [
      ...new Set(
        result.data.items.filter((item) => item.displayName === item.id).map((item) => item.id),
      ),
    ]
    if (unresolvedIds.length) {
      const resolved = await window.desktop!.accountData.resolveUserNames({
        targetId,
        userIds: unresolvedIds,
      })
      if (!resolved.ok) throw new Error(resolved.error.message)
      items.push(...withResolvedMemberNames(result.data.items, resolved.data))
    } else {
      items.push(...result.data.items)
    }
    cursor = result.data.nextCursor
    if (cursor && (!result.data.items.length || seen.has(cursor)))
      throw new Error("项目成员分页格式不正确")
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}
