import * as React from "react"
import { MessageSquare, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import type {
  ProjectTaskActivity,
  ProjectTaskActivityChange,
} from "@/components/projects/project-types"
import { MessageMarkdown } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { formatActivityTime } from "@/lib/activity-time"
import { useClientUsers } from "@/lib/client-data-context"
import {
  addClientProjectTaskComment,
  listClientProjectTaskActivities,
} from "@/lib/project-task-data-api"

export function ProjectTaskActivityFeed({
  assigneeNames = {},
  disabled,
  projectId,
  revision,
  taskId,
}: {
  assigneeNames?: Record<string, string>
  disabled?: boolean
  projectId: string
  revision: string
  taskId: string
}) {
  const [activities, setActivities] = React.useState<ProjectTaskActivity[]>([])
  const [comment, setComment] = React.useState("")
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const visibleActivities = expanded ? activities : activities.slice(-20)
  const activityUsers = useClientUsers(
    visibleActivities.flatMap((activity) => [
      activity.actor.id,
      ...activity.changes.flatMap((change) =>
        change.field === "assignee"
          ? [change.from, change.to].filter(
              (value): value is string => typeof value === "string"
            )
          : []
      ),
    ])
  )
  const resolvedAssigneeNames = React.useMemo(
    () => ({
      ...assigneeNames,
      ...Object.fromEntries(
        Array.from(activityUsers, ([id, user]) => [
          id,
          user?.nickname || user?.name || assigneeNames[id] || "",
        ])
      ),
    }),
    [activityUsers, assigneeNames]
  )
  const canExpand = (!expanded && activities.length > 20) || nextCursor !== null

  const loadActivities = React.useCallback(async () => {
    setLoading(true)
    try {
      const page = await listClientProjectTaskActivities(projectId, taskId)
      setActivities(page.activities)
      setExpanded(false)
      setNextCursor(page.nextCursor)
      setError("")
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "加载任务动态失败"
      )
    } finally {
      setLoading(false)
    }
  }, [projectId, taskId])

  React.useEffect(() => {
    let active = true
    void listClientProjectTaskActivities(projectId, taskId)
      .then((page) => {
        if (active) {
          setActivities(page.activities)
          setExpanded(false)
          setNextCursor(page.nextCursor)
          setError("")
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "加载任务动态失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [projectId, revision, taskId])

  async function handleLoadOlder() {
    if (!expanded && activities.length > 20) {
      setExpanded(true)
      return
    }
    if (!nextCursor || loadingOlder) {
      return
    }
    setLoadingOlder(true)
    try {
      const page = await listClientProjectTaskActivities(projectId, taskId, {
        cursor: nextCursor,
      })
      setActivities((current) => [...page.activities, ...current])
      setExpanded(true)
      setNextCursor(page.nextCursor)
    } catch (loadError) {
      toast.error(
        loadError instanceof Error ? loadError.message : "加载更早动态失败"
      )
    } finally {
      setLoadingOlder(false)
    }
  }

  async function handleSubmit() {
    const content = comment.trim()
    if (!content || submitting) {
      return
    }
    setSubmitting(true)
    try {
      const activity = await addClientProjectTaskComment(
        projectId,
        taskId,
        content
      )
      setActivities((current) => [...current, activity])
      setComment("")
      setError("")
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : "发表评论失败"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label="任务动态" className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">动态</h3>
        {loading && <Spinner />}
      </div>

      <div className="min-h-36 border-y py-3">
        {error ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 text-sm text-destructive">
            <span>{error}</span>
            <Button
              onClick={() => void loadActivities()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw />
              重试
            </Button>
          </div>
        ) : !loading && activities.length === 0 ? (
          <Empty className="min-h-28 rounded-none border-0 p-6">
            <EmptyMedia variant="icon">
              <MessageSquare />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-sm">暂无动态</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 py-1">
            {canExpand && (
              <Button
                className="mx-auto"
                disabled={loadingOlder}
                onClick={() => void handleLoadOlder()}
                size="sm"
                type="button"
                variant="ghost"
              >
                {loadingOlder && <Spinner />}
                展开更早动态
              </Button>
            )}
            {visibleActivities.map((activity) => (
              <TaskActivityItem
                activity={activity}
                assigneeNames={resolvedAssigneeNames}
                key={activity.id}
              />
            ))}
          </div>
        )}
      </div>

      <InputGroup>
        <InputGroupTextarea
          aria-label="发表评论"
          className="min-h-12!"
          disabled={disabled || submitting}
          maxLength={10000}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            if (submitting) {
              event.preventDefault()
              return
            }
            if (event.shiftKey || event.ctrlKey) {
              event.preventDefault()
              const target = event.currentTarget
              const start = target.selectionStart
              const end = target.selectionEnd
              const currentValue = target.value
              const nextComment = `${currentValue.slice(0, start)}\n${currentValue.slice(end)}`
              target.value = nextComment
              target.setSelectionRange(start + 1, start + 1)
              setComment(nextComment)
              return
            }
            event.preventDefault()
            void handleSubmit()
          }}
          placeholder="输入评论"
          rows={1}
          value={comment}
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton
            className="bg-neutral-900 text-neutral-50 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            disabled={disabled || submitting || !comment.trim()}
            onClick={() => void handleSubmit()}
            size="sm"
            variant="default"
          >
            {submitting ? <Spinner /> : <MessageSquare />}
            评论
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </section>
  )
}

function TaskActivityItem({
  activity,
  assigneeNames,
}: {
  activity: ProjectTaskActivity
  assigneeNames: Record<string, string>
}) {
  const name =
    assigneeNames[activity.actor.id] ||
    activity.actor.nickname ||
    activity.actor.name ||
    "用户"
  return (
    <article className="text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <a
            className="font-medium hover:text-primary"
            href={`/contacts/user/${encodeURIComponent(activity.actor.id)}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            {name}
          </a>
          <span className="text-muted-foreground">
            {getActivitySummary(activity, assigneeNames)}
          </span>
          <time
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            dateTime={activity.createdAt}
          >
            {formatActivityTime(activity.createdAt)}
          </time>
        </div>
        {activity.type === "commented" && (
          <div className="mt-1 rounded-md bg-muted/60 px-3 py-2 break-words">
            <MessageMarkdown content={activity.content} />
          </div>
        )}
      </div>
    </article>
  )
}

function getActivitySummary(
  activity: ProjectTaskActivity,
  assigneeNames: Record<string, string>
) {
  if (activity.type === "created") {
    return "创建了任务"
  }
  if (activity.type === "commented") {
    return "发表了评论"
  }
  if (activity.changes.length === 0) return "修改了任务"
  return (
    <>
      修改{" "}
      {activity.changes.map((change, index) => (
        <React.Fragment key={`${change.field}-${index}`}>
          {index > 0 && "、"}
          <strong className="font-semibold text-foreground">
            {getChangedFieldLabel(change.field)}
          </strong>
          {change.field !== "description" && (
            <>
              {" "}
              为{" "}
              <strong className="font-semibold text-foreground">
                {formatChangedValue(change, assigneeNames)}
              </strong>
            </>
          )}
        </React.Fragment>
      ))}
    </>
  )
}

function getChangedFieldLabel(field: string) {
  return (
    {
      assignee: "负责人",
      description: "详细内容",
      due_date: "截止日期",
      labels: "标签",
      priority: "优先级",
      reminder: "提醒时间",
      start_date: "开始日期",
      status: "状态",
      title: "标题",
    }[field] ?? "任务"
  )
}

function formatChangedValue(
  change: ProjectTaskActivityChange,
  assigneeNames: Record<string, string>
) {
  const value = change.to
  if (value === null || value === undefined || value === "") {
    return "未设置"
  }
  if (change.field === "status" && typeof value === "string") {
    return (
      {
        canceled: "已取消",
        done: "已完成",
        in_progress: "进行中",
        todo: "待办",
      }[value] ?? value
    )
  }
  if (change.field === "priority" && typeof value === "number") {
    return { 1: "低", 2: "中", 3: "高" }[value] ?? String(value)
  }
  if (change.field === "assignee") {
    if (typeof value === "string") {
      return assigneeNames[value] ?? "未知联系人"
    }
    if (typeof value === "object" && value !== null) {
      const user = value as {
        id?: unknown
        name?: unknown
        nickname?: unknown
      }
      if (typeof user.nickname === "string" && user.nickname) {
        return user.nickname
      }
      if (typeof user.name === "string" && user.name) return user.name
      if (typeof user.id === "string" && assigneeNames[user.id]) {
        return assigneeNames[user.id]
      }
    }
    return "未知联系人"
  }
  if (change.field === "labels" && Array.isArray(value)) {
    const labels = value.filter(
      (item): item is string => typeof item === "string"
    )
    return labels.length > 0 ? labels.join("、") : "无标签"
  }
  if (change.field === "reminder" && typeof value === "object") {
    const reminder = value as {
      at?: unknown
      frequency?: unknown
      time?: unknown
    }
    if (typeof reminder.at === "string") {
      return reminder.at.replace("T", " ").slice(0, 16)
    }
    if (typeof reminder.frequency === "string") {
      const frequency =
        { daily: "每天", monthly: "每月", weekly: "每周" }[
          reminder.frequency
        ] ?? reminder.frequency
      return typeof reminder.time === "string"
        ? `${frequency} ${reminder.time}`
        : frequency
    }
    return "已设置"
  }
  if (change.field === "title" && typeof value === "string") {
    return `“${value}”`
  }
  return String(value)
}
