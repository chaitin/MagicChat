import * as React from "react"
import { ChevronRight } from "lucide-react"

import { ProjectTaskDetailsDialog } from "@/components/projects/project-task-details-dialog"
import type { ProjectTask } from "@/components/projects/project-types"
import {
  ProjectTaskAssigneeAvatar,
  ProjectTaskStatusIcon,
} from "@/components/projects/project-task-view-elements"
import {
  addCalendarDays,
  differenceInCalendarDays,
  formatDateKey,
  formatShortDate,
  getProjectTaskDateRange,
  projectTaskStatusDetails,
} from "@/components/projects/project-task-view-utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const taskColumnWidth = 240
const minimumTimelineDays = 21

type Timeline = {
  cellWidth: number
  end: Date
  start: Date
  totalDays: number
  unitDays: number
  units: Date[]
}

export function ProjectTaskGanttView({
  emptyMessage = "暂无任务",
  onTaskUpdated,
  tasks,
}: {
  emptyMessage?: string
  onTaskUpdated: () => Promise<void>
  tasks: ProjectTask[]
}) {
  const [activeTask, setActiveTask] = React.useState<ProjectTask | null>(null)

  const scheduledTasks = tasks
    .map((task) => ({ range: getProjectTaskDateRange(task), task }))
    .filter(
      (
        item
      ): item is {
        range: NonNullable<ReturnType<typeof getProjectTaskDateRange>>
        task: ProjectTask
      } => item.range !== null
    )
    .sort(
      (left, right) => left.range.start.getTime() - right.range.start.getTime()
    )
  const unscheduledTasks = tasks.filter(
    (task) => !getProjectTaskDateRange(task)
  )
  const timeline = scheduledTasks.length
    ? createTimeline(scheduledTasks.map(({ range }) => range))
    : null

  return (
    <>
      {tasks.length === 0 ? (
        <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-4">
          {unscheduledTasks.length > 0 && (
            <Collapsible
              className="overflow-hidden rounded-md border bg-background shadow-xs"
              defaultOpen
            >
              <CollapsibleTrigger asChild>
                <Button
                  className="group/collapsible-trigger h-10 w-full justify-start rounded-none px-3 text-muted-foreground"
                  type="button"
                  variant="ghost"
                >
                  <ChevronRight className="transition-transform group-data-[state=open]/collapsible-trigger:rotate-90" />
                  未设置日期
                  <Badge
                    className="ml-auto min-w-5 bg-background px-1.5 tabular-nums"
                    variant="secondary"
                  >
                    {unscheduledTasks.length}
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t p-4">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {unscheduledTasks.map((task) => (
                    <button
                      className="group/task flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                      key={task.id}
                      onClick={() => setActiveTask(task)}
                      type="button"
                    >
                      <ProjectTaskStatusIcon
                        className={cn(
                          task.status === "todo"
                            ? "text-amber-600"
                            : task.status === "in_progress"
                              ? "text-sky-600"
                              : task.status === "done"
                                ? "text-emerald-600"
                                : "text-stone-500"
                        )}
                        status={task.status}
                      />
                      <span className="truncate transition-colors group-hover/task:text-sky-600">
                        {task.title}
                      </span>
                    </button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          {timeline && (
            <section className="overflow-hidden rounded-md border bg-background shadow-xs">
              <div className="flex min-w-0">
                <GanttTaskColumn
                  onOpenTask={setActiveTask}
                  tasks={scheduledTasks}
                  timeline={timeline}
                />
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <div
                    className="relative"
                    style={{
                      minWidth: timeline.units.length * timeline.cellWidth,
                    }}
                  >
                    <GanttTimelineHeader timeline={timeline} />
                    <div className="relative">
                      <TimelineBackground
                        rowCount={scheduledTasks.length}
                        timeline={timeline}
                      />
                      {scheduledTasks.map(({ range, task }) => (
                        <GanttTimelineTaskRow
                          key={task.id}
                          onOpen={() => setActiveTask(task)}
                          range={range}
                          task={task}
                          timeline={timeline}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
      {activeTask && (
        <ProjectTaskDetailsDialog
          key={`${activeTask.id}-${activeTask.updatedAt}`}
          onOpenChange={(open) => {
            if (!open) {
              setActiveTask(null)
            }
          }}
          onUpdated={onTaskUpdated}
          open
          task={activeTask}
        />
      )}
    </>
  )
}

function GanttTaskColumn({
  onOpenTask,
  tasks,
  timeline,
}: {
  onOpenTask: (task: ProjectTask) => void
  tasks: Array<{
    range: { end: Date; start: Date }
    task: ProjectTask
  }>
  timeline: Timeline
}) {
  return (
    <div
      className="shrink-0 border-r bg-background"
      style={{ width: taskColumnWidth }}
    >
      <div className="flex h-8 items-center border-b px-3 text-xs font-medium">
        任务
      </div>
      <div className="flex h-8 items-center border-b px-3 text-[11px] text-muted-foreground">
        {formatShortDate(timeline.start)} - {formatShortDate(timeline.end)}
      </div>
      {tasks.map(({ range, task }) => (
        <GanttTaskLabel
          key={task.id}
          onOpen={() => onOpenTask(task)}
          range={range}
          task={task}
        />
      ))}
    </div>
  )
}

function GanttTimelineHeader({ timeline }: { timeline: Timeline }) {
  const monthGroups = getMonthGroups(timeline)
  const todayKey = formatDateKey(new Date())

  return (
    <div className="sticky top-0 z-20 border-b bg-background">
      <div className="flex h-8 border-b">
        {monthGroups.map((group) => (
          <div
            className="shrink-0 border-r px-2 py-1.5 text-xs font-medium"
            key={group.key}
            style={{ width: group.unitCount * timeline.cellWidth }}
          >
            {group.label}
          </div>
        ))}
      </div>
      <div className="flex h-8">
        {timeline.units.map((date) => (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center border-r text-[10px] text-muted-foreground tabular-nums",
              isPastTimelineUnit(date, timeline, todayKey) && "bg-muted"
            )}
            key={formatDateKey(date)}
            style={{ width: timeline.cellWidth }}
          >
            {timeline.unitDays === 1 ? date.getDate() : formatShortDate(date)}
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineBackground({
  rowCount,
  timeline,
}: {
  rowCount: number
  timeline: Timeline
}) {
  const today = new Date()
  const todayKey = formatDateKey(today)
  const todayOffset = differenceInCalendarDays(today, timeline.start)
  const timelineWidth = timeline.units.length * timeline.cellWidth

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 bottom-0"
      style={{ left: 0, width: timelineWidth }}
    >
      <div className="absolute inset-0 flex">
        {timeline.units.map((date) => (
          <div
            className={cn(
              "h-full shrink-0 border-r",
              isPastTimelineUnit(date, timeline, todayKey) && "bg-muted"
            )}
            key={formatDateKey(date)}
            style={{ width: timeline.cellWidth }}
          />
        ))}
      </div>
      {todayOffset >= 0 && todayOffset < timeline.totalDays && (
        <div
          className="absolute top-0 bottom-0 z-10 w-px bg-rose-500/70"
          style={{
            left:
              (todayOffset / timeline.unitDays) * timeline.cellWidth +
              timeline.cellWidth / (2 * timeline.unitDays),
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, transparent calc(100% - 1px), var(--border) calc(100% - 1px))",
          backgroundSize: `100% calc(100% / ${rowCount})`,
        }}
      />
    </div>
  )
}

function GanttTaskLabel({
  onOpen,
  range,
  task,
}: {
  onOpen: () => void
  range: { end: Date; start: Date }
  task: ProjectTask
}) {
  return (
    <button
      className="group/task flex h-13 w-full cursor-pointer items-center gap-2 border-b bg-background px-3 text-left transition-colors last:border-b-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      onClick={onOpen}
      type="button"
    >
      <ProjectTaskStatusIcon
        className={cn(
          "shrink-0",
          task.status === "todo"
            ? "text-amber-600"
            : task.status === "in_progress"
              ? "text-sky-600"
              : task.status === "done"
                ? "text-emerald-600"
                : "text-stone-500"
        )}
        status={task.status}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium transition-colors group-hover/task:text-sky-600">
          {task.title}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {formatShortDate(range.start)} - {formatShortDate(range.end)}
        </span>
      </span>
    </button>
  )
}

function GanttTimelineTaskRow({
  onOpen,
  range,
  task,
  timeline,
}: {
  onOpen: () => void
  range: { end: Date; start: Date }
  task: ProjectTask
  timeline: Timeline
}) {
  const startOffset = differenceInCalendarDays(range.start, timeline.start)
  const duration = differenceInCalendarDays(range.end, range.start) + 1
  const left = (startOffset / timeline.unitDays) * timeline.cellWidth + 4
  const width = Math.max(
    24,
    (duration / timeline.unitDays) * timeline.cellWidth - 8
  )
  const compact = width < 48

  return (
    <div className="relative h-13 border-b last:border-b-0">
      <button
        aria-label={`查看任务详情：${task.title}`}
        className={cn(
          "absolute top-2.5 z-10 flex h-8 cursor-pointer items-center overflow-hidden rounded-sm text-left text-xs font-medium shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          compact ? "gap-0 px-1" : "gap-1.5 px-2",
          projectTaskStatusDetails[task.status].solidClassName,
          getGanttTaskHoverClassName(task.status)
        )}
        onClick={onOpen}
        style={{ left, width }}
        title={task.title}
        type="button"
      >
        {task.assignee && (
          <ProjectTaskAssigneeAvatar
            assignee={task.assignee}
            className="size-4 bg-muted"
          />
        )}
        {(!compact || !task.assignee) && (
          <span className="min-w-0 truncate">{task.title}</span>
        )}
      </button>
    </div>
  )
}

function getGanttTaskHoverClassName(status: ProjectTask["status"]) {
  switch (status) {
    case "in_progress":
      return "hover:bg-sky-200 hover:text-sky-600 dark:hover:bg-sky-900 dark:hover:text-sky-400"
    case "done":
      return "hover:bg-emerald-200 hover:text-emerald-600 dark:hover:bg-emerald-900 dark:hover:text-emerald-400"
    case "canceled":
      return "hover:bg-stone-200 hover:text-stone-600 dark:hover:bg-stone-900 dark:hover:text-stone-400"
    default:
      return "hover:bg-amber-200 hover:text-amber-600 dark:hover:bg-amber-900 dark:hover:text-amber-400"
  }
}

function isPastTimelineUnit(date: Date, timeline: Timeline, todayKey: string) {
  const unitEnd = addCalendarDays(date, timeline.unitDays - 1)
  return formatDateKey(unitEnd) < todayKey
}

function createTimeline(ranges: Array<{ end: Date; start: Date }>): Timeline {
  let start = new Date(
    Math.min(...ranges.map((range) => range.start.getTime()))
  )
  let end = new Date(Math.max(...ranges.map((range) => range.end.getTime())))
  start = addCalendarDays(start, -3)
  end = addCalendarDays(end, 3)

  const currentDays = differenceInCalendarDays(end, start) + 1
  if (currentDays < minimumTimelineDays) {
    const missingDays = minimumTimelineDays - currentDays
    start = addCalendarDays(start, -Math.floor(missingDays / 2))
    end = addCalendarDays(end, Math.ceil(missingDays / 2))
  }

  const totalDays = differenceInCalendarDays(end, start) + 1
  const unitDays = totalDays > 180 ? 7 : 1
  const cellWidth = unitDays === 1 ? 34 : 58
  const unitCount = Math.ceil(totalDays / unitDays)
  const units = Array.from({ length: unitCount }, (_, index) =>
    addCalendarDays(start, index * unitDays)
  )

  return { cellWidth, end, start, totalDays, unitDays, units }
}

function getMonthGroups(timeline: Timeline) {
  const groups: Array<{
    key: string
    label: string
    unitCount: number
  }> = []

  for (const date of timeline.units) {
    const key = `${date.getFullYear()}-${date.getMonth()}`
    const latestGroup = groups[groups.length - 1]
    if (latestGroup?.key === key) {
      latestGroup.unitCount += 1
    } else {
      groups.push({
        key,
        label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
        unitCount: 1,
      })
    }
  }
  return groups
}
