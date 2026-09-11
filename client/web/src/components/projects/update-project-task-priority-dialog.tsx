import * as React from "react"
import { ChevronsDown, ChevronsUp, Equal } from "lucide-react"
import { toast } from "sonner"

import type { ProjectTaskPriority } from "@/components/projects/project-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { updateClientProjectTask } from "@/lib/project-task-data-api"
import { cn } from "@/lib/utils"

const priorityOptions: Array<{
  icon: React.ComponentType<{ className?: string }>
  iconClassName: string
  label: string
  value: ProjectTaskPriority
}> = [
  {
    icon: ChevronsUp,
    iconClassName: "text-rose-600",
    label: "高",
    value: 3,
  },
  {
    icon: Equal,
    iconClassName: "text-amber-600",
    label: "中",
    value: 2,
  },
  {
    icon: ChevronsDown,
    iconClassName: "text-muted-foreground",
    label: "低",
    value: 1,
  },
]

export function UpdateProjectTaskPriorityDialog({
  currentPriority,
  onOpenChange,
  onUpdated,
  open,
  projectId,
  taskId,
}: {
  currentPriority: ProjectTaskPriority
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  projectId: string
  taskId: string
}) {
  const [priority, setPriority] =
    React.useState<ProjectTaskPriority>(currentPriority)
  const [saving, setSaving] = React.useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setPriority(currentPriority)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || priority === currentPriority) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, { priority })
      await onUpdated()
      onOpenChange(false)
      toast.success("任务优先级已更新")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新任务优先级失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5">
        <DialogHeader>
          <DialogTitle>修改优先级</DialogTitle>
          <DialogDescription className="sr-only">
            选择任务的新优先级。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <RadioGroup
            disabled={saving}
            onValueChange={(value) =>
              setPriority(Number(value) as ProjectTaskPriority)
            }
            value={String(priority)}
          >
            {priorityOptions.map((option) => {
              const Icon = option.icon
              const id = `task-priority-${taskId}-${option.value}`

              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                    priority === option.value && "border-foreground/30 bg-muted"
                  )}
                  htmlFor={id}
                  key={option.value}
                >
                  <RadioGroupItem id={id} value={String(option.value)} />
                  <Icon className={cn("size-4", option.iconClassName)} />
                  {option.label}
                </label>
              )
            })}
          </RadioGroup>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={saving || priority === currentPriority}
              type="submit"
            >
              {saving && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
