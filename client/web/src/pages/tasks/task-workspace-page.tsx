import * as React from "react"
import {
  ChevronDown,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  ListTodo,
  Loader2,
  Plus,
  Search,
} from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { CreateProjectTaskDialog } from "@/components/projects/create-project-task-dialog"
import { ProjectAvatar } from "@/components/projects/project-avatar"
import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import {
  PriorityFilter,
  StatusFilter,
} from "@/components/projects/project-tasks-tab"
import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getClientProject,
  listClientProjects,
  type ClientProjectSummary,
} from "@/lib/project-data-api"
import {
  getClientProjectTask,
  listClientProjectTasks,
} from "@/lib/project-task-data-api"
import {
  useOptionalClientData,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import { cn } from "@/lib/utils"

const emptyTaskUsersById: ClientDataContextValue["usersById"] = {}

const statusLabels = {
  canceled: "已取消",
  done: "已完成",
  in_progress: "进行中",
  todo: "待办",
} satisfies Record<ProjectTask["status"], string>

export function TaskWorkspacePage() {
  const { projectId = "", taskId = "" } = useParams<{
    projectId: string
    taskId?: string
  }>()
  if (!projectId) return null
  return (
    <LoadedTaskWorkspace
      key={projectId}
      projectId={projectId}
      taskId={taskId}
    />
  )
}

function LoadedTaskWorkspace({
  projectId,
  taskId,
}: {
  projectId: string
  taskId: string
}) {
  const navigate = useNavigate()
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const usersById = clientData?.usersById ?? emptyTaskUsersById
  const [storedActiveTask, setActiveTask] = React.useState<ProjectTask | null>(
    null
  )
  const [createOpen, setCreateOpen] = React.useState(false)
  const [error, setError] = React.useState("")
  const [keyword, setKeyword] = React.useState("")
  const deferredKeyword = React.useDeferredValue(keyword.trim())
  const [priorities, setPriorities] = React.useState<ProjectTaskPriority[]>([])
  const [statuses, setStatuses] = React.useState<ProjectTaskStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [loadedProject, setLoadedProject] =
    React.useState<ClientProjectSummary | null>(null)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [personalProject, setPersonalProject] =
    React.useState<ClientProjectSummary | null>(null)
  const [projects, setProjects] = React.useState<ClientProjectSummary[]>([])
  const [projectsLoadingMore, setProjectsLoadingMore] = React.useState(false)
  const [projectsNextCursor, setProjectsNextCursor] = React.useState<
    string | null
  >(null)
  const [storedTasks, setTasks] = React.useState<ProjectTask[]>([])
  const tasks = React.useMemo(
    () => hydrateProjectTasks(storedTasks, usersById),
    [storedTasks, usersById]
  )
  const activeTask = React.useMemo(
    () =>
      storedActiveTask
        ? (hydrateProjectTasks([storedActiveTask], usersById)[0] ??
          storedActiveTask)
        : null,
    [storedActiveTask, usersById]
  )
  const requestIdRef = React.useRef(0)

  React.useEffect(() => {
    if (!ensureUsers) return
    const userIds = new Set<string>()
    for (const task of activeTask ? [...tasks, activeTask] : tasks) {
      userIds.add(task.creator.id)
      if (task.assignee) userIds.add(task.assignee.id)
    }
    if (userIds.size > 0) {
      void ensureUsers(Array.from(userIds)).catch(() => undefined)
    }
  }, [activeTask, ensureUsers, tasks])

  const projectOptions = React.useMemo(() => {
    const values = [loadedProject, personalProject, ...projects].filter(
      (project): project is ClientProjectSummary => Boolean(project)
    )
    return values.filter(
      (project, index) =>
        project.id &&
        values.findIndex((value) => value.id === project.id) === index
    )
  }, [loadedProject, personalProject, projects])
  const currentProject = projectOptions.find(
    (project) => project.id === projectId
  )

  React.useEffect(() => {
    let active = true
    void listClientProjects({ limit: 100 })
      .then((page) => {
        if (active) {
          setPersonalProject(page.personalProject)
          setProjects(page.projects)
          setProjectsNextCursor(page.nextCursor)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          toast.error(
            loadError instanceof Error ? loadError.message : "加载项目列表失败"
          )
        }
      })
    return () => {
      active = false
    }
  }, [])

  async function loadMoreProjects() {
    if (!projectsNextCursor || projectsLoadingMore) return
    setProjectsLoadingMore(true)
    try {
      const page = await listClientProjects({
        cursor: projectsNextCursor,
        limit: 100,
      })
      setProjects((current) => [...current, ...page.projects])
      setProjectsNextCursor(page.nextCursor)
    } finally {
      setProjectsLoadingMore(false)
    }
  }

  React.useEffect(() => {
    if (currentProject) return
    let active = true
    void getClientProject(projectId)
      .then((project) => {
        if (active) setLoadedProject(project)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [currentProject, projectId])

  const loadTasks = React.useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const page = await listClientProjectTasks(projectId, {
        keyword: deferredKeyword || undefined,
        limit: 50,
        priorities,
        statuses,
      })
      if (requestId === requestIdRef.current) {
        setTasks(page.tasks)
        setNextCursor(page.nextCursor)
        setError("")
      }
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(
          loadError instanceof Error ? loadError.message : "加载任务列表失败"
        )
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [deferredKeyword, priorities, projectId, statuses])

  React.useEffect(() => {
    const requestId = ++requestIdRef.current
    void listClientProjectTasks(projectId, {
      keyword: deferredKeyword || undefined,
      limit: 50,
      priorities,
      statuses,
    })
      .then((page) => {
        if (requestId === requestIdRef.current) {
          setTasks(page.tasks)
          setNextCursor(page.nextCursor)
          setError("")
        }
      })
      .catch((loadError: unknown) => {
        if (requestId === requestIdRef.current) {
          setError(
            loadError instanceof Error ? loadError.message : "加载任务列表失败"
          )
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
    return () => {
      requestIdRef.current += 1
    }
  }, [deferredKeyword, priorities, projectId, statuses])

  const listedActiveTask = tasks.find((task) => task.id === taskId)
  const displayedActiveTask =
    listedActiveTask ?? (activeTask?.id === taskId ? activeTask : null)

  React.useEffect(() => {
    if (!taskId || listedActiveTask) return
    let active = true
    void getClientProjectTask(projectId, taskId)
      .then((task) => {
        if (active) setActiveTask(task)
      })
      .catch((loadError: unknown) => {
        if (active) {
          toast.error(
            loadError instanceof Error ? loadError.message : "加载任务详情失败"
          )
          navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
        }
      })
    return () => {
      active = false
    }
  }, [listedActiveTask, navigate, projectId, taskId])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listClientProjectTasks(projectId, {
        cursor: nextCursor,
        keyword: deferredKeyword || undefined,
        limit: 50,
        priorities,
        statuses,
      })
      setTasks((current) => [...current, ...page.tasks])
      setNextCursor(page.nextCursor)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : "加载更多任务失败"
      )
    } finally {
      setLoadingMore(false)
    }
  }

  function openTask(task: ProjectTask) {
    setActiveTask(task)
    navigate(
      `/tasks/${encodeURIComponent(projectId)}/${encodeURIComponent(task.id)}`
    )
  }

  async function handleTaskUpdated() {
    await loadTasks()
    if (taskId) {
      try {
        setActiveTask(await getClientProjectTask(projectId, taskId))
      } catch {
        // The details component already reports save failures.
      }
    }
  }

  function handleTaskDeleted(deletedTaskId: string) {
    setTasks((current) => current.filter((task) => task.id !== deletedTaskId))
    setActiveTask(null)
    navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
    void loadTasks()
  }

  return (
    <main className="flex h-svh min-w-0 gap-3 overflow-hidden bg-muted p-3">
      <aside
        aria-label="任务列表工作区"
        className={cn(
          "h-full w-full shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs md:flex md:w-80",
          taskId ? "hidden" : "flex"
        )}
      >
        <div className="mx-2 mt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="切换项目"
                className="h-10 w-full justify-start gap-2 px-2 font-semibold"
                type="button"
                variant="ghost"
              >
                {currentProject && (
                  <ProjectAvatar
                    className="size-7"
                    project={currentProject}
                    user={clientData?.me}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-left">
                  {currentProject?.name || "选择项目"}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                onValueChange={(nextProjectId) =>
                  navigate(`/tasks/${encodeURIComponent(nextProjectId)}`)
                }
                value={projectId}
              >
                {projectOptions.map((project) => (
                  <DropdownMenuRadioItem key={project.id} value={project.id}>
                    <ProjectAvatar
                      className="size-5"
                      project={project}
                      user={clientData?.me}
                    />
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {projectsNextCursor && (
                <DropdownMenuItem
                  disabled={projectsLoadingMore}
                  onSelect={(event) => {
                    event.preventDefault()
                    void loadMoreProjects().catch((loadError: unknown) =>
                      toast.error(
                        loadError instanceof Error
                          ? loadError.message
                          : "加载更多项目失败"
                      )
                    )
                  }}
                >
                  {projectsLoadingMore ? "正在加载更多项目" : "加载更多项目…"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid shrink-0 gap-2 px-3 py-2">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索任务"
                className="pl-8"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索任务"
                value={keyword}
              />
            </div>
            <Button
              aria-label="创建任务"
              onClick={() => setCreateOpen(true)}
              size="icon"
              title="创建任务"
              type="button"
            >
              <Plus />
            </Button>
          </div>
          <div aria-label="任务筛选" className="grid grid-cols-2 gap-2">
            <StatusFilter
              emptyLabel="全部状态"
              onValueChange={setStatuses}
              value={statuses}
            />
            <PriorityFilter
              emptyLabel="全部优先级"
              onValueChange={setPriorities}
              value={priorities}
            />
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <WorkspaceState loading message="正在加载任务" />
          ) : error ? (
            <WorkspaceState message={error}>
              <Button
                onClick={() => void loadTasks()}
                size="sm"
                type="button"
                variant="outline"
              >
                重试
              </Button>
            </WorkspaceState>
          ) : tasks.length === 0 ? (
            <WorkspaceState
              message={
                deferredKeyword || priorities.length || statuses.length
                  ? "没有匹配的任务"
                  : "暂无任务"
              }
            />
          ) : (
            <div aria-label="任务列表" className="grid gap-1" role="list">
              {tasks.map((task) => (
                <WorkspaceTaskItem
                  active={task.id === taskId}
                  key={task.id}
                  onClick={() => openTask(task)}
                  task={task}
                />
              ))}
              {nextCursor && (
                <Button
                  className="mx-auto mt-2"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {loadingMore && <Loader2 className="animate-spin" />}
                  加载更多
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>

      <section
        aria-label="任务内容工作区"
        className={cn(
          "min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-xs md:flex",
          taskId ? "flex" : "hidden"
        )}
      >
        {taskId && displayedActiveTask ? (
          <ProjectTaskDetailsDialog
            embedded
            key={displayedActiveTask.id}
            onDeleted={handleTaskDeleted}
            onOpenChange={(open) => {
              if (!open) navigate(`/tasks/${encodeURIComponent(projectId)}`)
            }}
            onUpdated={handleTaskUpdated}
            open
            task={displayedActiveTask}
          />
        ) : taskId ? (
          <WorkspaceState loading message="正在加载任务详情" />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <ListTodo className="size-6" />
            </span>
            <p className="text-sm">从左侧选择一个任务查看详情</p>
          </div>
        )}
      </section>

      <CreateProjectTaskDialog
        onCreated={loadTasks}
        onOpenChange={setCreateOpen}
        open={createOpen}
        projectId={projectId}
      />
    </main>
  )
}

function hydrateProjectTasks(
  tasks: ProjectTask[],
  usersById: ClientDataContextValue["usersById"]
) {
  let changed = false
  const next = tasks.map((task) => {
    const creator = usersById[task.creator.id]
    const assignee = task.assignee ? usersById[task.assignee.id] : undefined
    const nextCreator = creator
      ? {
          avatar: creator.avatar,
          id: creator.id,
          name: creator.name,
          nickname: creator.nickname,
        }
      : task.creator
    const nextAssignee = assignee
      ? {
          avatar: assignee.avatar,
          id: assignee.id,
          name: assignee.name,
          nickname: assignee.nickname,
        }
      : task.assignee
    if (
      nextCreator.avatar === task.creator.avatar &&
      nextCreator.name === task.creator.name &&
      nextCreator.nickname === task.creator.nickname &&
      nextAssignee?.avatar === task.assignee?.avatar &&
      nextAssignee?.name === task.assignee?.name &&
      nextAssignee?.nickname === task.assignee?.nickname
    ) {
      return task
    }
    changed = true
    return { ...task, assignee: nextAssignee, creator: nextCreator }
  })
  return changed ? next : tasks
}

function WorkspaceTaskItem({
  active,
  onClick,
  task,
}: {
  active: boolean
  onClick: () => void
  task: ProjectTask
}) {
  const assigneeName = task.assignee?.nickname || task.assignee?.name || ""
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid w-full gap-1.5 rounded-md px-3 py-2.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active &&
          "bg-(--weui-brand-1) hover:bg-(--weui-brand-1)"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <TaskStatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {task.title}
        </span>
        {task.priority === 3 && <Badge variant="destructive">高</Badge>}
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-6 text-xs text-muted-foreground">
        <span>{statusLabels[task.status]}</span>
        {task.dueDate && <span>截止 {task.dueDate.slice(5)}</span>}
        {task.assignee && (
          <span className="ml-auto flex min-w-0 items-center gap-1">
            <Avatar className="size-4">
              {task.assignee.avatar && (
                <AvatarImage alt={assigneeName} src={task.assignee.avatar} />
              )}
              <AvatarFallback className="text-[8px]">
                {Array.from(assigneeName)[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <span className="max-w-20 truncate">{assigneeName}</span>
          </span>
        )}
      </span>
    </button>
  )
}

function TaskStatusIcon({ status }: { status: ProjectTask["status"] }) {
  const className = "size-4 shrink-0"
  switch (status) {
    case "in_progress":
      return <CircleDot className={cn(className, "text-sky-600")} />
    case "done":
      return <CircleCheckBig className={cn(className, "text-emerald-600")} />
    case "canceled":
      return <CircleX className={cn(className, "text-stone-500")} />
    default:
      return <Circle className={cn(className, "text-amber-600")} />
  }
}

function WorkspaceState({
  children,
  loading = false,
  message,
}: {
  children?: React.ReactNode
  loading?: boolean
  message: string
}) {
  return (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      {loading && <Loader2 className="size-4 animate-spin" />}
      <span>{message}</span>
      {children}
    </div>
  )
}
