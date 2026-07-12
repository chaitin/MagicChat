import {
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Equal,
} from "lucide-react"

import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export function ProjectTaskStatusIcon({
  className,
  status,
}: {
  className?: string
  status: ProjectTaskStatus
}) {
  switch (status) {
    case "in_progress":
      return (
        <CircleDot aria-hidden="true" className={cn("size-4", className)} />
      )
    case "done":
      return (
        <CircleCheckBig
          aria-hidden="true"
          className={cn("size-4", className)}
        />
      )
    case "canceled":
      return <CircleX aria-hidden="true" className={cn("size-4", className)} />
    default:
      return <Circle aria-hidden="true" className={cn("size-4", className)} />
  }
}

export function ProjectTaskPriorityIcon({
  className,
  priority,
}: {
  className?: string
  priority: ProjectTaskPriority
}) {
  if (priority === 3) {
    return (
      <ChevronsUp
        aria-hidden="true"
        className={cn("size-3.5 text-rose-600", className)}
      />
    )
  }
  if (priority === 2) {
    return (
      <Equal
        aria-hidden="true"
        className={cn("size-3.5 text-amber-600", className)}
      />
    )
  }
  return (
    <ChevronsDown
      aria-hidden="true"
      className={cn("size-3.5 text-muted-foreground", className)}
    />
  )
}

export function ProjectTaskAssigneeAvatar({
  assignee,
  className,
}: {
  assignee: NonNullable<ProjectTask["assignee"]>
  className?: string
}) {
  const displayName = assignee.nickname || assignee.name
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"

  return (
    <Avatar
      className={cn("size-5 rounded-sm after:rounded-sm", className)}
      title={displayName}
    >
      {assignee.avatar && (
        <AvatarImage
          alt={displayName}
          className="rounded-sm"
          src={assignee.avatar}
        />
      )}
      <AvatarFallback className="rounded-sm text-[9px]">
        {initial}
      </AvatarFallback>
    </Avatar>
  )
}
