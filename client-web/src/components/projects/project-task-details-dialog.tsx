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

import { MessageMarkdown } from "@/components/message-markdown"
import type { ProjectTask } from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { getClientProjectTask } from "@/lib/project-task-data-api"

const statusLabels = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
  canceled: "已取消",
} satisfies Record<ProjectTask["status"], string>

const priorityLabels = {
  1: "低",
  2: "中",
  3: "高",
} satisfies Record<ProjectTask["priority"], string>

export function ProjectTaskDetailsDialog({
  onOpenChange,
  open,
  task,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  task: ProjectTask
}) {
  const [details, setDetails] = React.useState(task)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void getClientProjectTask(task.projectId, task.id)
      .then((nextDetails) => {
        if (active) {
          setDetails(nextDetails)
          setError("")
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "加载任务详情失败"
          )
        }
      })

    return () => {
      active = false
    }
  }, [open, task.id, task.projectId])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug">
            {details.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看任务详情。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <StatusBadge status={details.status} />
          <PriorityBadge priority={details.priority} />
          {details.labels.map((label) => (
            <Badge key={label} variant="secondary">
              {label}
            </Badge>
          ))}
        </div>

        {details.description && (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">描述</h3>
            <div className="rounded-md border bg-background p-3 text-sm">
              <MessageMarkdown content={details.description} />
            </div>
          </section>
        )}

        <Separator />

        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {details.assignee && (
            <DetailField label="负责人">
              <UserValue user={details.assignee} />
            </DetailField>
          )}
          <DetailField label="创建人">
            <UserValue user={details.creator} />
          </DetailField>
          {details.startDate && (
            <DetailField label="开始日期">{details.startDate}</DetailField>
          )}
          {details.dueDate && (
            <DetailField label="截止日期">{details.dueDate}</DetailField>
          )}
          {details.completedAt && (
            <DetailField label="完成时间">
              {formatDateTime(details.completedAt)}
            </DetailField>
          )}
          {details.canceledAt && (
            <DetailField label="取消时间">
              {formatDateTime(details.canceledAt)}
            </DetailField>
          )}
          <DetailField label="创建时间">
            {formatDateTime(details.createdAt)}
          </DetailField>
          <DetailField label="更新时间">
            {formatDateTime(details.updatedAt)}
          </DetailField>
        </dl>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

function DetailField({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

function UserValue({ user }: { user: ProjectTask["creator"] }) {
  const displayName = user.nickname || user.name
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-5 rounded-sm after:rounded-sm">
        {user.avatar && (
          <AvatarImage
            alt={displayName}
            className="rounded-sm"
            src={user.avatar}
          />
        )}
        <AvatarFallback className="rounded-sm text-[10px]">
          {initial}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{displayName}</span>
    </span>
  )
}

function StatusBadge({ status }: { status: ProjectTask["status"] }) {
  const iconClassName = "size-3"

  return (
    <Badge variant="outline">
      {status === "in_progress" ? (
        <CircleDot className={`${iconClassName} text-sky-600`} />
      ) : status === "done" ? (
        <CircleCheckBig className={`${iconClassName} text-emerald-600`} />
      ) : status === "canceled" ? (
        <CircleX className={`${iconClassName} text-stone-400`} />
      ) : (
        <Circle className={`${iconClassName} text-amber-600`} />
      )}
      {statusLabels[status]}
    </Badge>
  )
}

function PriorityBadge({ priority }: { priority: ProjectTask["priority"] }) {
  return (
    <Badge variant="outline">
      {priority === 3 ? (
        <ChevronsUp className="text-rose-600" />
      ) : priority === 2 ? (
        <Equal className="text-amber-600" />
      ) : (
        <ChevronsDown className="text-muted-foreground" />
      )}
      {priorityLabels[priority]}
    </Badge>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
