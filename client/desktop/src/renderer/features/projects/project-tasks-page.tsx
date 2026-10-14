import { startTransition, useEffect, useRef, useState, type FormEvent } from "react"
import {
  CalendarDays,
  ChartGantt,
  Check,
  ChevronDown,
  Columns3,
  ListFilterIcon,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Tag,
} from "lucide-react"
import type {
  DesktopProjectTask,
  ListProjectTasksInput,
  ProjectTaskAssignee,
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
import {
  TaskBoardView,
  TaskCalendarView,
  TaskGanttView,
  TaskListView,
  TaskPriorityIcon,
  TaskStatusIcon,
} from "./project-task-views"
import { TaskAssigneePicker } from "./task-assignee-picker"
import {
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
} from "./task-view-model"

type TaskView = "list" | "board" | "calendar" | "gantt"
type TaskFilters = {
  assigneeUserIds: string[]
  keyword: string
  labels: string[]
  statuses: ProjectTaskStatus[]
  priorities: ProjectTaskPriority[]
}

type TaskCacheKey = string
const taskPageCache = new Map<TaskCacheKey, DesktopProjectTask[]>()
const taskPageLoads = new Map<
  TaskCacheKey,
  {
    items: DesktopProjectTask[]
    listeners: Set<(items: DesktopProjectTask[]) => void>
    promise: Promise<DesktopProjectTask[]>
  }
>()

function taskCacheKey(input: ListProjectTasksInput): TaskCacheKey {
  return JSON.stringify([
    input.targetId,
    input.projectId,
    input.keyword ?? "",
    [...(input.statuses ?? [])].sort(),
    [...(input.priorities ?? [])].sort(),
    [...(input.assigneeUserIds ?? [])].sort(),
    [...(input.labels ?? [])].sort(),
  ])
}
const views: { id: TaskView; label: string; icon: typeof ListTodo }[] = [
  { id: "list", label: "任务列表", icon: ListTodo },
  { id: "board", label: "看板", icon: Columns3 },
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "gantt", label: "甘特图", icon: ChartGantt },
]
const defaultFilters: TaskFilters = {
  assigneeUserIds: [],
  keyword: "",
  labels: [],
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

export function ProjectTasksPage({
  targetId,
  projectId,
  resolvedTheme,
}: {
  targetId: string
  projectId: string
  resolvedTheme: "light" | "dark"
}) {
  const { showToast } = useAnimatedToast()
  const [view, setView] = useState<TaskView>(storedTaskView)
  const activeViewDetails = views.find((item) => item.id === view) ?? views[0]
  const ActiveViewIcon = activeViewDetails.icon
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<TaskFilters>(defaultFilters)
  const [tasks, setTasks] = useState<DesktopProjectTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [assigneeNames, setAssigneeNames] = useState<Map<string, string>>(() => new Map())
  const requestedAssigneeIds = useRef(new Set<string>())
  const [assignees, setAssignees] = useState<ProjectTaskAssignee[]>([])
  const [assigneesLoading, setAssigneesLoading] = useState(true)
  const [availableLabels, setAvailableLabels] = useState<string[]>([])
  const [labelsLoading, setLabelsLoading] = useState(true)
  const [labelsError, setLabelsError] = useState(false)

  useEffect(() => {
    let active = true
    const input = { targetId, projectId }
    const key = taskCacheKey(input)
    const cached = taskPageCache.get(key)
    if (cached) setAvailableLabels(collectTaskLabels(cached))
    setLabelsLoading(true)
    setLabelsError(false)
    void loadAllTasks(
      input,
      (items) => {
        if (active) setAvailableLabels(collectTaskLabels(items))
      },
      reload,
    )
      .then((items) => {
        if (active) taskPageCache.set(key, items)
      })
      .catch(() => {
        if (active) setLabelsError(true)
      })
      .finally(() => {
        if (active) setLabelsLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, reload])
  const selectedAssigneeId = filters.assigneeUserIds[0] ?? ""
  const selectedAssigneeName =
    assignees.find((member) => member.id === selectedAssigneeId)?.displayName ||
    assigneeNames.get(selectedAssigneeId) ||
    "未知成员"

  useEffect(() => {
    let active = true
    setAssigneesLoading(true)
    void loadAllAssignees(targetId, projectId)
      .then((members) => {
        if (active) setAssignees(members)
      })
      .catch((reason: unknown) => {
        if (active) {
          showToast({
            status: "error",
            title: reason instanceof Error ? reason.message : "加载负责人失败",
          })
        }
      })
      .finally(() => {
        if (active) setAssigneesLoading(false)
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, reload, showToast])

  useEffect(() => {
    let active = true
    const input = { targetId, projectId, ...appliedFilters }
    const key = taskCacheKey(input)
    const cached = taskPageCache.get(key)
    let receivedPage = Boolean(cached)
    setError("")
    if (cached) {
      setTasks(cached)
      setLoading(false)
    } else {
      setTasks([])
      setLoading(true)
    }
    void loadAllTasks(
      input,
      (items) => {
        if (!active) return
        receivedPage = true
        taskPageCache.set(key, items)
        setTasks(items)
        setLoading(false)
      },
      reload,
    )
      .then((items) => {
        if (!active) return
        taskPageCache.set(key, items)
        setTasks(items)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setLoading(false)
        if (!receivedPage) setError(reason instanceof Error ? reason.message : "加载任务列表失败")
        else {
          showToast({
            status: "warning",
            title: "任务列表未完全加载",
            description: reason instanceof Error ? reason.message : "部分任务加载失败",
          })
        }
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, appliedFilters, reload, showToast])

  useEffect(() => {
    const ids = [...new Set(tasks.flatMap((task) => (task.assignee ? [task.assignee.id] : [])))]
    const pending = ids.filter((id) => !requestedAssigneeIds.current.has(id))
    if (!pending.length) return
    pending.forEach((id) => requestedAssigneeIds.current.add(id))
    void window
      .desktop!.accountData.resolveUserNames({ targetId, userIds: pending })
      .then((result) => {
        if (!result.ok) return
        setAssigneeNames((current) => {
          const next = new Map(current)
          for (const user of result.data) if (user.name) next.set(user.id, user.name)
          return next
        })
      })
  }, [targetId, tasks])

  useEffect(
    () =>
      window.desktop!.taskWindows.onChanged((change) => {
        if (change.targetId === targetId && change.projectId === projectId)
          setReload((current) => current + 1)
      }),
    [targetId, projectId],
  )

  async function openTask(task: DesktopProjectTask | "new") {
    try {
      const result = await window.desktop!.taskWindows.open({
        targetId,
        projectId,
        ...(task === "new" ? {} : { taskId: task.id }),
      })
      if (!result.ok) throw new Error(result.error.message)
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : "打开任务窗口失败",
      })
    }
  }

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
    startTransition(() => setView(next))
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
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 pt-2.5 pb-[9px]">
        <div
          role="group"
          aria-label="任务视图"
          className="flex shrink-0 items-center gap-1 @max-[849px]/task-pane:hidden"
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
              className="hidden shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-4 @max-[849px]/task-pane:inline-flex"
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
              className="h-8 w-32"
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
            <DropdownMenuContent className="max-h-96 w-48 overflow-y-auto" align="end">
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
              <DropdownMenuSeparator />
              <DropdownMenuLabel>标签</DropdownMenuLabel>
              {[...new Set([...availableLabels, ...filters.labels])].map((label) => (
                <DropdownMenuCheckboxItem
                  key={label}
                  checked={filters.labels.includes(label)}
                  className="cursor-pointer hover:bg-foreground/10 focus:bg-foreground/10 data-highlighted:bg-foreground/10"
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    changeFilter(
                      "labels",
                      filters.labels.includes(label)
                        ? filters.labels.filter((item) => item !== label)
                        : [...filters.labels, label],
                    )
                  }
                >
                  <Tag className="size-4 shrink-0" />
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {(labelsLoading || labelsError || availableLabels.length === 0) && (
                <DropdownMenuItem disabled>
                  {labelsLoading
                    ? "正在加载标签…"
                    : labelsError
                      ? "标签加载失败，请刷新"
                      : "暂无标签"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <TaskAssigneePicker
            targetId={targetId}
            members={assignees}
            value={selectedAssigneeId}
            name={selectedAssigneeName}
            theme={resolvedTheme}
            disabled={assigneesLoading}
            emptyLabel={assigneesLoading ? "加载负责人…" : "所有负责人"}
            ariaLabel="筛选负责人"
            className="h-8 w-24 shrink-0 @max-[779px]/task-pane:hidden"
            contentClassName="min-w-48"
            onChange={(id) => changeFilter("assigneeUserIds", id ? [id] : [])}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="刷新任务"
            onClick={() => setReload((current) => current + 1)}
          >
            <RefreshCw />
          </Button>
          <Button type="button" size="sm" onClick={() => void openTask("new")}>
            <Plus />
            创建任务
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
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
          onOpen={(task) => void openTask(task)}
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
              targetId={targetId}
              theme={resolvedTheme}
              assigneeNames={assigneeNames}
              onOpen={(task) => void openTask(task)}
              onMove={(task, status) => void moveStatus(task, status)}
              onPriorityChange={(task, priority) => void movePriority(task, priority)}
            />
          )}
          {view === "calendar" && (
            <TaskCalendarView tasks={tasks} onOpen={(task) => void openTask(task)} />
          )}
          {view === "gantt" && (
            <TaskGanttView tasks={tasks} onOpen={(task) => void openTask(task)} />
          )}
        </ScrollArea>
      )}
    </section>
  )
}

function hasFilters(filters: TaskFilters) {
  return Boolean(
    filters.keyword ||
    filters.priorities.length ||
    filters.statuses.length ||
    filters.assigneeUserIds.length ||
    filters.labels.length,
  )
}

function collectTaskLabels(tasks: DesktopProjectTask[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.labels))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  )
}

async function loadAllAssignees(
  targetId: string,
  projectId: string,
): Promise<ProjectTaskAssignee[]> {
  const items: ProjectTaskAssignee[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const result = await window.desktop!.accountData.listProjectTaskAssignees({
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

async function loadAllTasks(
  input: ListProjectTasksInput,
  onPage: (items: DesktopProjectTask[]) => void,
  generation = 0,
): Promise<DesktopProjectTask[]> {
  const key = `${taskCacheKey(input)}\n${generation}`
  const pending = taskPageLoads.get(key)
  if (pending) {
    pending.listeners.add(onPage)
    try {
      if (pending.items.length) onPage([...pending.items])
      return await pending.promise
    } finally {
      pending.listeners.delete(onPage)
    }
  }
  const items: DesktopProjectTask[] = []
  const listeners = new Set([onPage])
  const promise = (async () => {
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
      for (const listener of listeners) listener([...items])
      cursor = result.data.nextCursor
      if (cursor && (!result.data.items.length || seen.has(cursor)))
        throw new Error("任务列表分页格式不正确")
      if (cursor) seen.add(cursor)
    } while (cursor)
    return items
  })()
  const load = { items, listeners, promise }
  taskPageLoads.set(key, load)
  try {
    return await promise
  } finally {
    taskPageLoads.delete(key)
  }
}
