import * as React from "react"
import { toast } from "sonner"

import { ProjectTaskDatePicker } from "@/components/projects/project-task-date-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { updateClientProjectTask } from "@/lib/project-task-data-api"

export function UpdateProjectTaskDateDialog({
  currentValue,
  dateType,
  onOpenChange,
  onUpdated,
  open,
  otherValue,
  projectId,
  taskId,
}: {
  currentValue: string | null
  dateType: "start" | "due"
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  otherValue: string | null
  projectId: string
  taskId: string
}) {
  const [saving, setSaving] = React.useState(false)
  const [value, setValue] = React.useState(currentValue ?? "")
  const fieldLabel = dateType === "start" ? "开始日期" : "截止日期"

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setValue(currentValue ?? "")
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || value === (currentValue ?? "")) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, {
        ...(dateType === "start"
          ? { startDate: value || null }
          : { dueDate: value || null }),
      })
      await onUpdated()
      onOpenChange(false)
      toast.success(`${fieldLabel}已更新`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `更新${fieldLabel}失败`
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改{fieldLabel}</DialogTitle>
          <DialogDescription className="sr-only">
            选择任务的{fieldLabel}。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <ProjectTaskDatePicker
            disabled={saving}
            label={fieldLabel}
            maximum={
              dateType === "start" ? (otherValue ?? undefined) : undefined
            }
            minimum={dateType === "due" ? (otherValue ?? undefined) : undefined}
            onValueChange={setValue}
            value={value}
          />
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
              disabled={saving || value === (currentValue ?? "")}
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
