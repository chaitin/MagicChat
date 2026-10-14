import { useState, type ReactNode } from "react"
import {
  CircleQuestionMarkIcon,
  BanIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleSmallIcon,
  Dot,
} from "lucide-react"
import type {
  DesktopProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  addDays,
  calendarTasksOnDate,
  daysBetween,
  formatDateKey,
  ganttColumnSpan,
  isGanttColumnCurrent,
  taskDateRange,
  taskStatusLabels,
  taskStatuses,
  taskPriorityLabels,
  taskPriorities,
} from "./task-view-model"

export const taskSelectItemClassName =
  "cursor-pointer hover:bg-foreground/10 focus:bg-foreground/10 data-highlighted:bg-foreground/10 not-data-[variant=destructive]:focus:**:text-inherit"

export const priorityIconColors: Record<ProjectTaskPriority, string> = {
  1: "text-blue-500!",
  2: "text-yellow-600! dark:text-yellow-400!",
  3: "text-red-500!",
}

export function TaskPriorityIcon({ priority }: { priority: ProjectTaskPriority }) {
  return (
    <CircleSmallIcon className={cn("size-4 shrink-0", priorityIconColors[priority])} aria-hidden />
  )
}

const priorityBorderColors: Record<ProjectTaskPriority, string> = {
  1: "border-l-blue-500",
  2: "border-l-yellow-500",
  3: "border-l-red-500",
}

export const statusIconColors: Record<ProjectTaskStatus, string> = {
  todo: "text-amber-600! dark:text-amber-400!",
  in_progress: "text-sky-600! dark:text-sky-400!",
  done: "text-emerald-600! dark:text-emerald-400!",
  canceled: "text-stone-600! dark:text-stone-400!",
}

const statusColors: Record<ProjectTaskStatus, string> = {
  todo: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  in_progress:
    "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  done: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  canceled:
    "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200",
}

const timelineStatusColors: Record<ProjectTaskStatus, string> = {
  todo: "border-amber-300/60 bg-amber-100/75 dark:border-amber-700/60 dark:bg-amber-900/75",
  in_progress: "border-sky-300/60 bg-sky-100/75 dark:border-sky-700/60 dark:bg-sky-900/75",
  done: "border-emerald-300/60 bg-emerald-100/75 dark:border-emerald-700/60 dark:bg-emerald-900/75",
  canceled: "border-stone-300/60 bg-stone-100/75 dark:border-stone-700/60 dark:bg-stone-900/75",
}

const statusHoverColors: Record<ProjectTaskStatus, string> = {
  todo: "hover:border-amber-300/75 hover:bg-amber-200/65 dark:hover:border-amber-700/75 dark:hover:bg-amber-800/65",
  in_progress:
    "hover:border-sky-300/75 hover:bg-sky-200/65 dark:hover:border-sky-700/75 dark:hover:bg-sky-800/65",
  done: "hover:border-emerald-300/75 hover:bg-emerald-200/65 dark:hover:border-emerald-700/75 dark:hover:bg-emerald-800/65",
  canceled:
    "hover:border-stone-300/75 hover:bg-stone-200/65 dark:hover:border-stone-700/75 dark:hover:bg-stone-800/65",
}

export function TaskStatusIcon({
  status,
  className,
}: {
  status: ProjectTaskStatus
  className?: string
}) {
  const Icon =
    status === "done"
      ? CircleCheck
      : status === "canceled"
        ? BanIcon
        : status === "in_progress"
          ? CircleDot
          : CircleQuestionMarkIcon
  return <Icon className={cn("size-4 shrink-0", statusIconColors[status], className)} aria-hidden />
}

export function TaskListView({
  tasks,
  targetId,
  theme,
  assigneeNames,
  onOpen,
  onMove,
  onPriorityChange,
}: {
  tasks: DesktopProjectTask[]
  targetId: string
  theme: "light" | "dark"
  assigneeNames: ReadonlyMap<string, string>
  onOpen: (task: DesktopProjectTask) => void
  onMove: (task: DesktopProjectTask, status: ProjectTaskStatus) => void
  onPriorityChange: (task: DesktopProjectTask, priority: ProjectTaskPriority) => void
}) {
  return (
    <div aria-label="任务列表" className="grid gap-2 p-4">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-md border border-l-2 bg-card px-3 py-3 shadow-xs hover:bg-muted/50",
            priorityBorderColors[task.priority],
          )}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:text-xgui-brand focus-visible:text-xgui-brand"
                onClick={() => onOpen(task)}
                aria-label={`查看任务详情：${task.title}`}
              >
                {task.title}
              </button>
              {task.assignee && (
                <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <EntityAvatar
                    targetId={targetId}
                    type="user"
                    id={task.assignee.id}
                    theme={theme}
                    size={18}
                    className="rounded-full"
                    label={`${assigneeNames.get(task.assignee.id) || task.assignee.nickname || task.assignee.name || task.assignee.id}头像`}
                  />
                  <span className="max-w-32 truncate">
                    {assigneeNames.get(task.assignee.id) ||
                      task.assignee.nickname ||
                      task.assignee.name ||
                      task.assignee.id}
                  </span>
                </span>
              )}
            </div>
            <span
              className="block min-w-0 truncate text-xs text-muted-foreground"
              title={task.description.trim() || "暂无详细说明"}
            >
              {task.description.trim() || "暂无详细说明"}
            </span>
            <TaskMetaLine task={task} />
          </div>
          <Select
            value={String(task.priority)}
            onValueChange={(value) => onPriorityChange(task, Number(value) as ProjectTaskPriority)}
          >
            <SelectTrigger
              size="sm"
              aria-label={`${task.title}的优先级`}
              className="w-20 shrink-0 cursor-pointer"
            >
              <SelectValue>
                <TaskPriorityIcon priority={task.priority} />
                {taskPriorityLabels[task.priority]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {taskPriorities.map((priority) => (
                <SelectItem
                  key={priority}
                  value={String(priority)}
                  indicatorClassName={priorityIconColors[priority]}
                  className={taskSelectItemClassName}
                >
                  <TaskPriorityIcon priority={priority} />
                  {taskPriorityLabels[priority]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={task.status}
            onValueChange={(value) => onMove(task, value as ProjectTaskStatus)}
          >
            <SelectTrigger
              size="sm"
              aria-label={`${task.title}的状态`}
              className="w-28 shrink-0 cursor-pointer"
            >
              <SelectValue>
                <TaskStatusIcon status={task.status} />
                {taskStatusLabels[task.status]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {taskStatuses.map((status) => (
                <SelectItem
                  key={status}
                  value={status}
                  indicatorClassName={statusIconColors[status]}
                  className={taskSelectItemClassName}
                >
                  <TaskStatusIcon status={status} />
                  {taskStatusLabels[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
}

export function TaskBoardView({
  tasks,
  onOpen,
  onMove,
}: {
  tasks: DesktopProjectTask[]
  onOpen: (task: DesktopProjectTask) => void
  onMove: (task: DesktopProjectTask, status: ProjectTaskStatus) => void
}) {
  return (
    <div
      aria-label="任务看板"
      className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4"
    >
      <div className="grid h-full min-h-0 min-w-[56rem] flex-1 grid-cols-4 gap-3">
        {taskStatuses.map((status) => {
          const column = tasks.filter((task) => task.status === status)
          return (
            <section
              key={status}
              aria-label={taskStatusLabels[status]}
              className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-muted/40"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const id = event.dataTransfer.getData("text/plain")
                const task = tasks.find((item) => item.id === id)
                if (task && task.status !== status) onMove(task, status)
              }}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <Badge variant="outline" className={cn("rounded-md", statusColors[status])}>
                  {taskStatusLabels[status]}
                </Badge>
                <Badge
                  variant="secondary"
                  className="min-w-5 bg-xgui-background-0 px-1.5 text-muted-foreground tabular-nums"
                >
                  {column.length}
                </Badge>
              </header>
              <ScrollArea
                type="hover"
                scrollHideDelay={200}
                className="min-h-0 min-w-0 flex-1"
                viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full!"
              >
                <div className="grid content-start gap-2 p-2">
                  {column.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">暂无任务</p>
                  )}
                  {column.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(event) => {
                        if (event.target instanceof Element && event.target.closest("button")) {
                          event.preventDefault()
                          return
                        }
                        event.dataTransfer.setData("text/plain", task.id)
                      }}
                      className={cn(
                        "flex min-w-0 cursor-grab flex-col gap-2 rounded-md border border-l-2 bg-card p-3 text-left text-sm shadow-xs hover:bg-muted/50 active:cursor-grabbing",
                        priorityBorderColors[task.priority],
                      )}
                    >
                      <span className="sr-only">优先级{taskPriorityLabels[task.priority]}</span>
                      <div className="flex min-w-0 items-center font-medium">
                        <button
                          type="button"
                          onClick={() => onOpen(task)}
                          className="min-w-0 cursor-pointer truncate text-left hover:text-xgui-brand focus-visible:rounded-sm focus-visible:text-xgui-brand focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`查看任务详情：${task.title}`}
                        >
                          {task.title}
                        </button>
                      </div>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={task.description.trim() || "暂无详细说明"}
                      >
                        {task.description.trim() || "暂无详细说明"}
                      </span>
                      <TaskMetaLine task={task} includeDates={false} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>
          )
        })}
      </div>
    </div>
  )
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"]

function TaskMetaLine({
  task,
  includeDates = true,
}: {
  task: DesktopProjectTask
  includeDates?: boolean
}) {
  const labels = task.labels.filter((label) => label.trim())
  const items: ReactNode[] = [
    ...(includeDates && task.startDate ? [`${task.startDate} 开始`] : []),
    ...(includeDates && task.dueDate ? [`截至 ${task.dueDate}`] : []),
    ...(labels.length
      ? [
          <span className="flex min-w-0 items-center gap-1" key="labels">
            {labels.map((label) => (
              <Badge
                key={label}
                variant="outline"
                className="h-5 max-w-24 truncate border-sky-300 bg-sky-100 px-1.5 text-[11px] font-normal text-sky-600 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
              >
                {label}
              </Badge>
            ))}
          </span>,
        ]
      : []),
  ]
  if (!items.length) return null
  return (
    <div className="flex min-w-0 items-center truncate whitespace-nowrap text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={index} className="flex min-w-0 items-center">
          {index > 0 && <Dot className="mx-0.5 size-3 shrink-0" aria-hidden />}
          {item}
        </span>
      ))}
    </div>
  )
}

function UnscheduledTasksSection({
  tasks,
  onOpen,
}: {
  tasks: DesktopProjectTask[]
  onOpen: (task: DesktopProjectTask) => void
}) {
  return (
    <Collapsible asChild>
      <section className="overflow-hidden rounded-md border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex w-full cursor-pointer items-center gap-2 p-3 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden
            />
            <span className="text-sm font-medium">未设置日期</span>
            <Badge
              variant="secondary"
              className="ml-auto min-w-5 bg-xgui-background-0 px-1.5 text-muted-foreground tabular-nums"
            >
              {tasks.length}
            </Badge>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-3">
          <div className="flex flex-wrap gap-2">
            {tasks.map((task) => (
              <Button
                key={task.id}
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => onOpen(task)}
              >
                {task.title}
              </Button>
            ))}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

export function TaskCalendarView({
  tasks,
  onOpen,
}: {
  tasks: DesktopProjectTask[]
  onOpen: (task: DesktopProjectTask) => void
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )
  const first = addDays(month, -(month.getDay() + 6) % 7)
  const cells = Array.from({ length: 42 }, (_, index) => addDays(first, index))
  const unscheduled = tasks.filter((task) => !taskDateRange(task))
  const today = formatDateKey(new Date())
  return (
    <div aria-label="任务日历" className="grid gap-4 p-4">
      {unscheduled.length > 0 && <UnscheduledTasksSection tasks={unscheduled} onOpen={onOpen} />}
      <section className="overflow-x-auto rounded-md border bg-card">
        <div className="min-w-[42rem]">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4" />
              <span className="text-sm font-medium">
                {month.getFullYear()} 年 {month.getMonth() + 1} 月
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
                }
              >
                今天
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="上个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="下个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </header>
          <div className="grid grid-cols-7">
            {weekdays.map((day) => (
              <span
                key={day}
                className="border-r border-b bg-xgui-background-1 py-2 text-center text-xs last:border-r-0"
              >
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day) => {
              const matches = calendarTasksOnDate(tasks, day)
              const dateLabel = formatDateKey(day).slice(5)
              return (
                <div
                  key={formatDateKey(day)}
                  className={cn(
                    "min-h-28 border-r border-b p-1.5 text-xs",
                    day.getMonth() !== month.getMonth() &&
                      "bg-xgui-background-1 text-muted-foreground",
                  )}
                >
                  <div className="flex h-6 items-center">
                    {formatDateKey(day) === today ? (
                      <Badge variant="default" className="h-6" aria-current="date">
                        {dateLabel}
                      </Badge>
                    ) : (
                      <span className="px-2">{dateLabel}</span>
                    )}
                  </div>
                  <div className="mt-1.5 grid gap-1">
                    {matches.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpen(task)}
                        className={cn(
                          "h-7 w-full cursor-pointer truncate rounded border px-1 py-0.5 text-left transition-colors",
                          statusColors[task.status],
                          timelineStatusColors[task.status],
                          statusHoverColors[task.status],
                        )}
                        title={task.title}
                      >
                        {task.title}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

export function TaskGanttView({
  tasks,
  onOpen,
}: {
  tasks: DesktopProjectTask[]
  onOpen: (task: DesktopProjectTask) => void
}) {
  const scheduled = tasks.filter((task) => taskDateRange(task))
  const unscheduled = tasks.filter((task) => !taskDateRange(task))
  const first = scheduled.length
    ? new Date(Math.min(...scheduled.map((task) => taskDateRange(task)!.start.getTime())))
    : new Date()
  const last = scheduled.length
    ? new Date(Math.max(...scheduled.map((task) => taskDateRange(task)!.end.getTime())))
    : addDays(first, 20)
  const spanDays = Math.max(21, daysBetween(last, first) + 1)
  const unitDays = spanDays > 90 ? Math.ceil(spanDays / 90 / 7) * 7 : 1
  const columns = Math.ceil(spanDays / unitDays)
  const columnWidth = 64
  const timelineWidth = columns * columnWidth
  const today = new Date()
  return (
    <div aria-label="任务甘特图" className="grid gap-4 p-4">
      {unscheduled.length > 0 && <UnscheduledTasksSection tasks={unscheduled} onOpen={onOpen} />}
      {scheduled.length > 0 && (
        <section className="min-w-0 overflow-hidden rounded-md border bg-card">
          <ScrollArea
            type="hover"
            scrollHideDelay={200}
            scrollbarOrientation="horizontal"
            className="w-full [&_[data-slot=scroll-area-scrollbar]]:z-20"
            viewportClassName="overflow-y-hidden"
          >
            <div className="min-w-max pb-3" style={{ width: 224 + timelineWidth }}>
              <header className="flex h-10 border-b text-xs font-medium">
                <div className="sticky left-0 z-10 flex w-56 shrink-0 items-center border-r bg-card px-3">
                  任务
                </div>
                <div className="relative flex flex-1">
                  {Array.from({ length: columns }, (_, index) => {
                    const isCurrent = isGanttColumnCurrent(first, today, index, unitDays)
                    const dateLabel = formatDateKey(addDays(first, index * unitDays)).slice(5)
                    return (
                      <span
                        key={index}
                        aria-current={isCurrent ? "date" : undefined}
                        className="inline-flex h-full w-16 shrink-0 items-center justify-center border-r px-1 text-center"
                      >
                        {isCurrent ? <Badge variant="default">{dateLabel}</Badge> : dateLabel}
                      </span>
                    )
                  })}
                </div>
              </header>
              {scheduled.map((task) => {
                const span = ganttColumnSpan(task, first, unitDays)!
                return (
                  <div key={task.id} className="flex h-10 border-b text-sm last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onOpen(task)}
                      className="sticky left-0 z-10 w-56 shrink-0 cursor-pointer truncate border-r bg-card px-3 text-left hover:text-primary"
                      title={task.title}
                    >
                      {task.title}
                    </button>
                    <div
                      className="relative flex-1 bg-muted/20"
                      style={{
                        backgroundSize: `${columnWidth}px 100%`,
                        backgroundImage:
                          "linear-gradient(to left, var(--border) 1px, transparent 1px)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpen(task)}
                        className={cn(
                          "absolute top-1/2 h-7 min-w-3 -translate-y-1/2 cursor-pointer truncate rounded border px-2 text-left text-xs transition-colors",
                          statusColors[task.status],
                          timelineStatusColors[task.status],
                          statusHoverColors[task.status],
                        )}
                        style={{
                          left: span.left * columnWidth,
                          width: span.width * columnWidth,
                        }}
                        title={task.title}
                      >
                        {task.title}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </section>
      )}
      {tasks.length === 0 && <p className="text-center text-sm text-muted-foreground">暂无任务</p>}
    </div>
  )
}
