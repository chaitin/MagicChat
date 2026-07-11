import * as React from "react"
import {
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Equal,
} from "lucide-react"

import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import { UpdateProjectTaskPriorityDialog } from "@/components/projects/update-project-task-priority-dialog"
import { UpdateProjectTaskStatusDialog } from "@/components/projects/update-project-task-status-dialog"
import type { ProjectTask } from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { formatRelativeTime } from "@/lib/relative-time"
import { cn } from "@/lib/utils"

const priorityLabels = {
  1: "低",
  2: "中",
  3: "高",
} satisfies Record<ProjectTask["priority"], string>

const statusLabels = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
  canceled: "已取消",
} satisfies Record<ProjectTask["status"], string>

export function ProjectTaskListView({
  emptyMessage = "暂无任务",
  onTaskUpdated,
  tasks,
}: {
  emptyMessage?: string
  onTaskUpdated: () => Promise<void>
  tasks: ProjectTask[]
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <ItemGroup aria-label="任务列表" className="gap-2">
      {tasks.map((task) => (
        <TaskItem key={task.id} onUpdated={onTaskUpdated} task={task} />
      ))}
    </ItemGroup>
  )
}

function TaskItem({
  onUpdated,
  task,
}: {
  onUpdated: () => Promise<void>
  task: ProjectTask
}) {
  const closed = task.status === "done" || task.status === "canceled"
  const overdue = !closed && isPastDate(task.dueDate)
  const now = new Date()
  const [detailsDialogOpen, setDetailsDialogOpen] = React.useState(false)
  const [priorityDialogOpen, setPriorityDialogOpen] = React.useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)

  return (
    <div role="listitem">
      <Item
        className={cn(
          "cursor-pointer items-start bg-background px-3 py-3 shadow-xs hover:border-ring/50 hover:bg-muted hover:ring-1 hover:ring-ring/50",
          closed && "bg-muted"
        )}
        aria-label={`查看任务详情：${task.title}`}
        onClick={() => setDetailsDialogOpen(true)}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault()
            setDetailsDialogOpen(true)
          }
        }}
        role="button"
        size="sm"
        tabIndex={0}
        variant="outline"
      >
        <ItemMedia>
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-sm border",
              task.status === "in_progress"
                ? "border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-950"
                : task.status === "done"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950"
                  : task.status === "canceled"
                    ? "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-950"
                    : "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950"
            )}
          >
            <TaskStatusIcon status={task.status} />
          </div>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle
            className={cn(
              "w-full",
              closed && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </ItemTitle>
          {task.description && (
            <ItemDescription>{task.description}</ItemDescription>
          )}
        </ItemContent>
        <ItemFooter className="flex-wrap justify-start gap-2">
          <StatusBadge
            onClick={(event) => {
              event.stopPropagation()
              setStatusDialogOpen(true)
            }}
            status={task.status}
          />
          <PriorityBadge
            onClick={(event) => {
              event.stopPropagation()
              setPriorityDialogOpen(true)
            }}
            priority={task.priority}
          />
          {task.assignee && (
            <Badge variant="outline">
              <Avatar className="size-4 rounded-sm after:rounded-sm">
                {task.assignee.avatar && (
                  <AvatarImage
                    alt={task.assignee.nickname || task.assignee.name}
                    className="rounded-sm"
                    src={task.assignee.avatar}
                  />
                )}
                <AvatarFallback className="rounded-sm text-[8px]">
                  {getUserInitial(task.assignee.nickname || task.assignee.name)}
                </AvatarFallback>
              </Avatar>
              {task.assignee.nickname || task.assignee.name}
            </Badge>
          )}
          <TaskDateBadge label="开始" value={task.startDate} />
          <TaskDateBadge label="截止" overdue={overdue} value={task.dueDate} />
          <div className="ml-auto flex shrink-0 items-center text-xs whitespace-nowrap text-muted-foreground">
            <time dateTime={task.createdAt} title={task.createdAt}>
              {formatRelativeTime(task.createdAt, now)}创建
            </time>
            <span>，</span>
            <time dateTime={task.updatedAt} title={task.updatedAt}>
              {formatRelativeTime(task.updatedAt, now)}更新
            </time>
          </div>
        </ItemFooter>
      </Item>
      <ProjectTaskDetailsDialog
        key={`${task.id}-${task.updatedAt}`}
        onOpenChange={setDetailsDialogOpen}
        open={detailsDialogOpen}
        task={task}
      />
      <UpdateProjectTaskStatusDialog
        currentStatus={task.status}
        onOpenChange={setStatusDialogOpen}
        onUpdated={onUpdated}
        open={statusDialogOpen}
        projectId={task.projectId}
        taskId={task.id}
      />
      <UpdateProjectTaskPriorityDialog
        currentPriority={task.priority}
        onOpenChange={setPriorityDialogOpen}
        onUpdated={onUpdated}
        open={priorityDialogOpen}
        projectId={task.projectId}
        taskId={task.id}
      />
    </div>
  )
}

function getUserInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function TaskStatusIcon({
  colored = false,
  status,
}: {
  colored?: boolean
  status: ProjectTask["status"]
}) {
  switch (status) {
    case "in_progress":
      return (
        <CircleDot
          aria-hidden="true"
          className={cn("size-4", colored && "text-sky-600")}
        />
      )
    case "done":
      return (
        <CircleCheckBig
          aria-hidden="true"
          className={cn("size-4", colored && "text-emerald-600")}
        />
      )
    case "canceled":
      return (
        <CircleX
          aria-hidden="true"
          className={cn("size-4", colored && "text-stone-400")}
        />
      )
    default:
      return (
        <Circle
          aria-hidden="true"
          className={cn("size-4", colored && "text-amber-600")}
        />
      )
  }
}

function StatusBadge({
  onClick,
  status,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>
  status: ProjectTask["status"]
}) {
  return (
    <Badge asChild variant="outline">
      <button
        aria-label={`修改任务状态，当前为${statusLabels[status]}`}
        className="cursor-pointer hover:text-sky-600 hover:ring-1 hover:ring-ring/50"
        onClick={onClick}
        type="button"
      >
        <TaskStatusIcon colored status={status} />
        {statusLabels[status]}
      </button>
    </Badge>
  )
}

function PriorityBadge({
  onClick,
  priority,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>
  priority: ProjectTask["priority"]
}) {
  return (
    <Badge asChild variant="outline">
      <button
        aria-label={`修改任务优先级，当前为${priorityLabels[priority]}`}
        className="cursor-pointer hover:text-sky-600 hover:ring-1 hover:ring-ring/50"
        onClick={onClick}
        type="button"
      >
        {priority === 3 ? (
          <ChevronsUp aria-hidden="true" className="text-rose-600" />
        ) : priority === 2 ? (
          <Equal aria-hidden="true" className="text-amber-600" />
        ) : (
          <ChevronsDown aria-hidden="true" className="text-muted-foreground" />
        )}
        {priorityLabels[priority]}
      </button>
    </Badge>
  )
}

function TaskDateBadge({
  label,
  overdue = false,
  value,
}: {
  label: string
  overdue?: boolean
  value: string | null
}) {
  if (!value) {
    return null
  }

  return (
    <Badge
      className={cn(!overdue && "text-muted-foreground")}
      variant={overdue ? "warning" : "outline"}
    >
      {label} <time dateTime={value}>{value}</time>
    </Badge>
  )
}

function isPastDate(value: string | null) {
  if (!value) {
    return false
  }

  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  return value < `${year}-${month}-${day}`
}
