import * as React from "react"
import {
  ArrowLeft,
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
import {
  AssigneeFilter,
  PriorityFilter,
  StatusFilter,
} from "@/components/projects/project-tasks-tab"
import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
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
import { useLocale } from "@/components/locale-provider"
import { useOptionalClientData } from "@/lib/client-data-context"
import {
  getClientProject,
  listClientProjects,
  type ClientProjectSummary,
} from "@/lib/project-data-api"
import { getClientProjectTask, listClientProjectTasks } from "@/lib/project-task-data-api"
import {
  displayProjectUser,
  EMPTY_PROJECT_USERS,
  getProjectTaskUserIds,
  hydrateProjectTask,
  hydrateProjectTasks,
} from "@/lib/project-user-hydration"
import { listAllClientProjectMembers } from "@/lib/project-members"
import { cn } from "@/lib/utils"

const statusLabelKeys = {
  canceled: "project.filter.canceled",
  done: "project.filter.done",
  in_progress: "project.filter.in_progress",
  todo: "project.filter.todo",
} as const satisfies Record<ProjectTask["status"], string>

const taskWorkspaceStatus = {
  loading: "project.loadingTasks",
  noMatch: "project.noTaskMatch",
  noTasks: "project.noTasks",
  retry: "project.reload",
} as const

export function TaskWorkspacePage() {
  const { projectId = "", taskId = "" } = useParams<{ projectId: string; taskId?: string }>()
  if (!projectId) return null
  return <LoadedTaskWorkspace key={projectId} projectId={projectId} taskId={taskId} />
}

function LoadedTaskWorkspace({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const usersById = clientData?.usersById ?? EMPTY_PROJECT_USERS
  const [activeTask, setActiveTask] = React.useState<ProjectTask | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [error, setError] = React.useState("")
  const [keyword, setKeyword] = React.useState("")
  const deferredKeyword = React.useDeferredValue(keyword.trim())
  const [priorities, setPriorities] = React.useState<ProjectTaskPriority[]>([])
  const [statuses, setStatuses] = React.useState<ProjectTaskStatus[]>([])
  const [assigneeUserIds, setAssigneeUserIds] = React.useState<string[]>([])
  const [members, setMembers] = React.useState<
    Awaited<ReturnType<typeof listAllClientProjectMembers>>
  >([])
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [membersError, setMembersError] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [projects, setProjects] = React.useState<ClientProjectSummary[]>([])
  const [personalProject, setPersonalProject] = React.useState<ClientProjectSummary | null>(null)
  const [currentProject, setCurrentProject] = React.useState<ClientProjectSummary | null>(null)
  const [projectsLoadingMore, setProjectsLoadingMore] = React.useState(false)
  const [projectsNextCursor, setProjectsNextCursor] = React.useState<string | null>(null)
  const [tasks, setTasks] = React.useState<ProjectTask[]>([])
  const requestIdRef = React.useRef(0)

  const projectOptions = React.useMemo(() => {
    const values = [currentProject, personalProject, ...projects].filter(
      (project): project is ClientProjectSummary => Boolean(project),
    )
    return values.filter(
      (project, index) => values.findIndex((value) => value.id === project.id) === index,
    )
  }, [currentProject, personalProject, projects])

  const loadTasks = React.useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadingMore(false)
    try {
      const page = await listClientProjectTasks(projectId, {
        assigneeUserIds,
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
        setError(loadError instanceof Error ? loadError.message : t("project.loadTasksFailed"))
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [assigneeUserIds, deferredKeyword, priorities, projectId, statuses, t])

  React.useEffect(() => {
    let active = true
    setMembersLoading(true)
    setMembersError(false)
    void listAllClientProjectMembers(projectId)
      .then((values) => active && setMembers(values))
      .catch(() => active && setMembersError(true))
      .finally(() => active && setMembersLoading(false))
    void listClientProjects({ limit: 100 })
      .then((page) => {
        if (!active) return
        setPersonalProject(page.personalProject)
        setProjects(page.projects)
        setProjectsNextCursor(page.nextCursor)
      })
      .catch((loadError: unknown) => {
        if (active)
          toast.error(
            loadError instanceof Error ? loadError.message : t("taskWorkspace.projectsLoadFailed"),
          )
      })
    void getClientProject(projectId)
      .then((project) => {
        if (active) setCurrentProject(project)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [projectId, t])

  async function loadMoreProjects() {
    if (!projectsNextCursor || projectsLoadingMore) return
    setProjectsLoadingMore(true)
    try {
      const page = await listClientProjects({ cursor: projectsNextCursor, limit: 100 })
      setProjects((current) => [...current, ...page.projects])
      setProjectsNextCursor(page.nextCursor)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : t("taskWorkspace.moreProjectsLoadFailed"),
      )
    } finally {
      setProjectsLoadingMore(false)
    }
  }

  React.useEffect(() => {
    void loadTasks()
    return () => {
      requestIdRef.current += 1
    }
  }, [loadTasks])

  const activeTaskRequestIdRef = React.useRef(0)
  const refreshActiveTask = React.useCallback(
    async (options: { navigateOnError: boolean }) => {
      if (!taskId) return
      const requestId = ++activeTaskRequestIdRef.current
      try {
        const task = await getClientProjectTask(projectId, taskId)
        if (requestId === activeTaskRequestIdRef.current) {
          setActiveTask(task)
        }
      } catch (loadError) {
        if (requestId !== activeTaskRequestIdRef.current) return
        fetchedActiveTaskIdRef.current = ""
        if (options.navigateOnError) {
          toast.error(loadError instanceof Error ? loadError.message : t("project.loadTaskFailed"))
          navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
        } else {
          toast.error(t("taskWorkspace.taskRefreshFailed"))
        }
      }
    },
    [navigate, projectId, t, taskId],
  )

  const tasksSnapshotRef = React.useRef(tasks)
  tasksSnapshotRef.current = tasks
  const fetchedActiveTaskIdRef = React.useRef("")
  React.useEffect(() => {
    if (!taskId) return
    if (tasksSnapshotRef.current.some((task) => task.id === taskId)) return
    if (fetchedActiveTaskIdRef.current === taskId) return
    fetchedActiveTaskIdRef.current = taskId
    void refreshActiveTask({ navigateOnError: true })
    return () => {
      activeTaskRequestIdRef.current += 1
      if (fetchedActiveTaskIdRef.current === taskId) {
        fetchedActiveTaskIdRef.current = ""
      }
    }
  }, [refreshActiveTask, taskId])

  const displayedTask =
    tasks.find((task) => task.id === taskId) ?? (activeTask?.id === taskId ? activeTask : null)
  const taskUserIds = React.useMemo(
    () => getProjectTaskUserIds(displayedTask ? [...tasks, displayedTask] : tasks),
    [displayedTask, tasks],
  )
  const taskUserKey = taskUserIds.join("\u0000")
  React.useEffect(() => {
    if (taskUserKey) void ensureUsers?.(taskUserIds).catch(() => undefined)
  }, [ensureUsers, taskUserIds, taskUserKey])
  const hydratedTasks = React.useMemo(
    () => hydrateProjectTasks(tasks, usersById),
    [tasks, usersById],
  )
  const hydratedDisplayedTask = React.useMemo(
    () => (displayedTask ? hydrateProjectTask(displayedTask, usersById) : null),
    [displayedTask, usersById],
  )

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const requestId = requestIdRef.current
    setLoadingMore(true)
    try {
      const page = await listClientProjectTasks(projectId, {
        assigneeUserIds,
        cursor: nextCursor,
        keyword: deferredKeyword || undefined,
        limit: 50,
        priorities,
        statuses,
      })
      if (requestId === requestIdRef.current) {
        setTasks((current) => {
          const seen = new Set(current.map((task) => task.id))
          return [...current, ...page.tasks.filter((task) => !seen.has(task.id))]
        })
        setNextCursor(page.nextCursor)
      }
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        toast.error(
          loadError instanceof Error ? loadError.message : t("taskWorkspace.moreTasksLoadFailed"),
        )
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false)
    }
  }

  function openTask(task: ProjectTask) {
    setActiveTask(task)
    navigate(`/tasks/${encodeURIComponent(projectId)}/${encodeURIComponent(task.id)}`)
  }

  function handleTaskDeleted(deletedTaskId: string) {
    activeTaskRequestIdRef.current += 1
    setTasks((current) => current.filter((task) => task.id !== deletedTaskId))
    setActiveTask(null)
    navigate(`/tasks/${encodeURIComponent(projectId)}`, { replace: true })
    void loadTasks()
  }

  async function handleTaskUpdated() {
    await loadTasks()
    await refreshActiveTask({ navigateOnError: false })
  }

  return (
    <main className="flex h-svh min-w-0 gap-3 overflow-hidden bg-muted p-3 pt-10">
      <aside
        aria-label={t("taskWorkspace.taskList")}
        className={cn(
          "flex h-full w-full shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs md:w-80",
          taskId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="mx-2 mt-2 flex items-center gap-1">
          <Button
            aria-label={t("taskWorkspace.backToChat")}
            onClick={() => navigate("/chat")}
            size="icon-sm"
            title={t("taskWorkspace.backToChat")}
            type="button"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("taskWorkspace.switchProject")}
                className="h-10 min-w-0 flex-1 justify-start gap-2 px-2 font-semibold"
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
                  {currentProject?.name || t("taskWorkspace.selectProject")}
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
                    <ProjectAvatar className="size-5" project={project} user={clientData?.me} />
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {projectsNextCursor && (
                <DropdownMenuItem
                  disabled={projectsLoadingMore}
                  onSelect={(event) => {
                    event.preventDefault()
                    void loadMoreProjects()
                  }}
                >
                  {projectsLoadingMore
                    ? t("taskWorkspace.loadingMoreProjects")
                    : t("taskWorkspace.loadMoreProjects")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="grid shrink-0 gap-2 px-3 pb-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t("project.searchTasks")}
                className="pl-8"
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("project.searchTasks")}
                value={keyword}
              />
            </div>
            <Button
              aria-label={t("project.createTask")}
              onClick={() => setCreateOpen(true)}
              size="icon"
              title={t("project.createTask")}
              type="button"
            >
              <Plus />
            </Button>
          </div>
          <div aria-label={t("taskWorkspace.filters")} className="flex flex-wrap gap-2">
            <StatusFilter
              emptyLabel={t("taskWorkspace.allStatuses")}
              onValueChange={setStatuses}
              value={statuses}
            />
            <PriorityFilter
              emptyLabel={t("taskWorkspace.allPriorities")}
              onValueChange={setPriorities}
              value={priorities}
            />
            <AssigneeFilter
              loading={membersLoading}
              members={members}
              membersError={membersError}
              onValueChange={setAssigneeUserIds}
              selectedAssignees={members.filter((member) => assigneeUserIds.includes(member.id))}
              value={assigneeUserIds}
            />
          </div>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <WorkspaceState loading message={t(taskWorkspaceStatus.loading)} />
          ) : error ? (
            <WorkspaceState message={error}>
              <Button onClick={() => void loadTasks()} size="sm" type="button" variant="outline">
                {t(taskWorkspaceStatus.retry)}
              </Button>
            </WorkspaceState>
          ) : tasks.length === 0 ? (
            <WorkspaceState
              message={t(
                deferredKeyword ||
                  statuses.length > 0 ||
                  priorities.length > 0 ||
                  assigneeUserIds.length > 0
                  ? taskWorkspaceStatus.noMatch
                  : taskWorkspaceStatus.noTasks,
              )}
            />
          ) : (
            <div aria-label={t("project.task.list")} className="grid gap-1" role="list">
              {hydratedTasks.map((task) => (
                <WorkspaceTaskItem
                  active={task.id === taskId}
                  key={task.id}
                  onClick={() => openTask(task)}
                  task={task}
                  translate={t}
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
                  {t("project.loadMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>
      <section
        aria-label={t("taskWorkspace.taskContent")}
        className={cn(
          "min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-xs md:flex",
          taskId ? "flex" : "hidden",
        )}
      >
        {taskId && hydratedDisplayedTask ? (
          <ProjectTaskDetailsDialog
            embedded
            key={hydratedDisplayedTask.id}
            onDeleted={handleTaskDeleted}
            onOpenChange={(open) => {
              if (!open) navigate(`/tasks/${encodeURIComponent(projectId)}`)
            }}
            onUpdated={handleTaskUpdated}
            open
            task={hydratedDisplayedTask}
          />
        ) : taskId ? (
          <WorkspaceState loading message={t("taskWorkspace.loadingTask")} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <ListTodo className="size-6" />
            </span>
            <p className="text-sm">{t("taskWorkspace.selectTask")}</p>
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

function WorkspaceTaskItem({
  active,
  onClick,
  task,
  translate,
}: {
  active: boolean
  onClick: () => void
  task: ProjectTask
  translate: ReturnType<typeof useLocale>["t"]
}) {
  const assigneeName = task.assignee ? displayProjectUser(task.assignee) : ""
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid w-full gap-1.5 rounded-md px-3 py-2.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active && "bg-primary/10 hover:bg-primary/10 dark:bg-primary/15 dark:hover:bg-primary/15",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <TaskStatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
        {task.priority === 3 && (
          <Badge variant="destructive">{translate("project.priority.high")}</Badge>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-6 text-xs text-muted-foreground">
        <span>{translate(statusLabelKeys[task.status])}</span>
        {task.dueDate && (
          <span>{translate("project.task.dueDate", { date: task.dueDate.slice(5) })}</span>
        )}
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
  if (status === "in_progress") return <CircleDot className={cn(className, "text-sky-600")} />
  if (status === "done") return <CircleCheckBig className={cn(className, "text-emerald-600")} />
  if (status === "canceled") return <CircleX className={cn(className, "text-stone-500")} />
  return <Circle className={cn(className, "text-amber-600")} />
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
