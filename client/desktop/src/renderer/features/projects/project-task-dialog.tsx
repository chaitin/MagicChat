import { useEffect, useState, type FormEvent } from "react"
import { Bell, MessageSquare, Trash2 } from "lucide-react"
import type {
  DesktopProjectTask,
  ProjectMember,
  ProjectTaskActivity,
  ProjectTaskPriority,
  ProjectTaskReminderInput,
  ProjectTaskStatus,
} from "../../../shared/account-data"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
} from "./task-view-model"

type TaskForm = {
  title: string
  description: string
  status: ProjectTaskStatus
  priority: ProjectTaskPriority
  assigneeUserId: string
  startDate: string
  dueDate: string
  labels: string
  reminder: ProjectTaskReminderInput | null
}

function initialForm(task: DesktopProjectTask | null): TaskForm {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? "todo",
    priority: task?.priority ?? 2,
    assigneeUserId: task?.assignee?.id ?? "",
    startDate: task?.startDate ?? "",
    dueDate: task?.dueDate ?? "",
    labels: task?.labels.join(", ") ?? "",
    reminder: task?.reminder ?? null,
  }
}

export function ProjectTaskDialog({
  targetId,
  projectId,
  task,
  members,
  onClose,
  onChanged,
}: {
  targetId: string
  projectId: string
  task: DesktopProjectTask | null
  members: ProjectMember[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [form, setForm] = useState<TaskForm>(() => initialForm(task))
  const [details, setDetails] = useState(task)
  const [loadingDetails, setLoadingDetails] = useState(Boolean(task))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [activityError, setActivityError] = useState("")
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [comment, setComment] = useState("")
  const [commenting, setCommenting] = useState(false)

  async function loadActivities(cursor?: string) {
    if (!task || loadingActivities) return
    setLoadingActivities(true)
    setActivityError("")
    try {
      const result = await window.desktop!.accountData.listProjectTaskActivities({
        targetId,
        projectId,
        taskId: task.id,
        ...(cursor ? { cursor } : {}),
      })
      if (!result.ok) throw new Error(result.error.message)
      setActivities((current) => (cursor ? [...current, ...result.data.items] : result.data.items))
      setNextCursor(result.data.nextCursor)
    } catch (reason) {
      setActivityError(reason instanceof Error ? reason.message : "加载任务动态失败")
    } finally {
      setLoadingActivities(false)
    }
  }

  useEffect(() => {
    if (!task) return
    let active = true
    void window
      .desktop!.accountData.getProjectTask({ targetId, projectId, taskId: task.id })
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        setDetails(result.data)
        setForm((current) => (current.title === task.title ? initialForm(result.data) : current))
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "加载任务详情失败")
      })
      .finally(() => {
        if (active) setLoadingDetails(false)
      })
    void window
      .desktop!.accountData.listProjectTaskActivities({ targetId, projectId, taskId: task.id })
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        setActivities(result.data.items)
        setNextCursor(result.data.nextCursor)
      })
      .catch((reason: unknown) => {
        if (active) setActivityError(reason instanceof Error ? reason.message : "加载任务动态失败")
      })
    return () => {
      active = false
    }
  }, [targetId, projectId, task?.id])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || loadingDetails) return
    setError("")
    const title = form.title.trim()
    if (!title) return setError("请填写任务标题")
    if (form.startDate && form.dueDate && form.startDate > form.dueDate)
      return setError("开始日期不能晚于截止日期")
    const labels = [
      ...new Set(
        form.labels
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]
    setSaving(true)
    try {
      const fields = {
        title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        assigneeUserId: form.assigneeUserId || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        labels,
        reminder: form.reminder,
      }
      const result = task
        ? await window.desktop!.accountData.updateProjectTask({
            targetId,
            projectId,
            taskId: task.id,
            ...fields,
          })
        : await window.desktop!.accountData.createProjectTask({ targetId, projectId, ...fields })
      if (!result.ok) throw new Error(result.error.message)
      await onChanged()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存任务失败")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!task || saving) return
    setSaving(true)
    setError("")
    try {
      const result = await window.desktop!.accountData.deleteProjectTask({
        targetId,
        projectId,
        taskId: task.id,
      })
      if (!result.ok) throw new Error(result.error.message)
      await onChanged()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除任务失败")
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!task || commenting || !comment.trim()) return
    setCommenting(true)
    setActivityError("")
    try {
      const result = await window.desktop!.accountData.addProjectTaskComment({
        targetId,
        projectId,
        taskId: task.id,
        content: comment.trim(),
      })
      if (!result.ok) throw new Error(result.error.message)
      setComment("")
      await loadActivities()
    } catch (reason) {
      setActivityError(reason instanceof Error ? reason.message : "添加评论失败")
    } finally {
      setCommenting(false)
    }
  }

  function change<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100vh-3rem)] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? "任务详情" : "创建任务"}</DialogTitle>
          <DialogDescription>
            {task ? "查看和编辑任务信息" : "填写任务标题、负责人和时间安排"}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <Field label="任务标题">
            <Input
              autoFocus
              required
              maxLength={240}
              value={form.title}
              disabled={saving || loadingDetails}
              onChange={(event) => change("title", event.target.value)}
            />
          </Field>
          <Field label="任务描述">
            <Textarea
              className="min-h-24"
              value={form.description}
              disabled={saving || loadingDetails}
              onChange={(event) => change("description", event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="状态">
              <select
                className={selectClass}
                value={form.status}
                disabled={saving || loadingDetails}
                onChange={(event) => change("status", event.target.value as ProjectTaskStatus)}
              >
                {taskStatuses.map((status) => (
                  <option key={status} value={status}>
                    {taskStatusLabels[status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="优先级">
              <select
                className={selectClass}
                value={form.priority}
                disabled={saving || loadingDetails}
                onChange={(event) =>
                  change("priority", Number(event.target.value) as ProjectTaskPriority)
                }
              >
                {taskPriorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {taskPriorityLabels[priority]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="负责人">
              <select
                className={selectClass}
                value={form.assigneeUserId}
                disabled={saving || loadingDetails}
                onChange={(event) => change("assigneeUserId", event.target.value)}
              >
                <option value="">未分配</option>
                {members
                  .filter((member) => member.status === "active")
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="标签（逗号分隔）">
              <Input
                value={form.labels}
                disabled={saving || loadingDetails}
                onChange={(event) => change("labels", event.target.value)}
                placeholder="例如：发版, 设计"
              />
            </Field>
            <Field label="开始日期">
              <Input
                type="date"
                value={form.startDate}
                disabled={saving || loadingDetails}
                onChange={(event) => change("startDate", event.target.value)}
              />
            </Field>
            <Field label="截止日期">
              <Input
                type="date"
                value={form.dueDate}
                disabled={saving || loadingDetails}
                onChange={(event) => change("dueDate", event.target.value)}
              />
            </Field>
          </div>
          {loadingDetails ? (
            <p className="text-xs text-muted-foreground">正在加载任务详情…</p>
          ) : (
            <TaskReminderField
              value={form.reminder}
              onChange={(value) => change("reminder", value)}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="items-center">
            {task && (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={saving || loadingDetails}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
                删除
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={saving || loadingDetails}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={saving || loadingDetails || !form.title.trim()}>
              {saving ? "保存中…" : task ? "保存修改" : "创建任务"}
            </Button>
          </DialogFooter>
        </form>
        {details && (
          <p className="text-xs text-muted-foreground">
            创建人：{details.creator.nickname || details.creator.name || details.creator.id}
            {` · 创建于 ${new Date(details.createdAt).toLocaleString("zh-CN")}`}
            {` · 更新于 ${new Date(details.updatedAt).toLocaleString("zh-CN")}`}
          </p>
        )}
        {details?.reminder && (
          <p className="text-xs text-muted-foreground">
            提醒状态：
            {
              { scheduled: "已安排", paused: "已暂停", fired: "已触发", expired: "已过期" }[
                details.reminder.state
              ]
            }
            {details.reminder.nextTriggerAt
              ? ` · 下次提醒 ${new Date(details.reminder.nextTriggerAt).toLocaleString("zh-CN")}`
              : ""}
          </p>
        )}
        {task && (
          <section aria-label="任务动态" className="grid gap-3 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-4" />
              任务动态
            </h3>
            {activities.length === 0 && !activityError && (
              <p className="text-xs text-muted-foreground">暂无动态</p>
            )}
            <div className="grid max-h-52 gap-2 overflow-y-auto">
              {activities.map((activity) => (
                <div key={activity.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                  <span className="font-medium">
                    {activity.actor.nickname || activity.actor.name}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {new Date(activity.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap">
                    {activity.type === "commented"
                      ? activity.content
                      : activity.type === "created"
                        ? "创建了任务"
                        : `更新了任务${activity.changes.length ? `：${activity.changes.map((change) => change.field).join("、")}` : ""}`}
                  </p>
                </div>
              ))}
            </div>
            {nextCursor && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingActivities}
                onClick={() => void loadActivities(nextCursor)}
              >
                {loadingActivities ? "加载中…" : "加载更多动态"}
              </Button>
            )}
            {activityError && (
              <p role="alert" className="text-xs text-destructive">
                {activityError}
              </p>
            )}
            <form className="flex gap-2" onSubmit={(event) => void addComment(event)}>
              <Input
                aria-label="评论内容"
                placeholder="添加评论"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button type="submit" disabled={commenting || !comment.trim()}>
                {commenting ? "发送中" : "发送"}
              </Button>
            </form>
          </section>
        )}
      </DialogContent>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!saving) setConfirmDelete(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除“{task?.title}”吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => void remove()}
            >
              {saving ? "删除中" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function TaskReminderField({
  value,
  onChange,
}: {
  value: ProjectTaskReminderInput | null
  onChange: (value: ProjectTaskReminderInput | null) => void
}) {
  const mode = value?.mode ?? "none"
  const shanghaiNow = new Date(Date.now() + 8 * 60 * 60_000 + 60_000).toISOString().slice(0, 16)
  return (
    <fieldset className="grid gap-2 rounded-md border p-3 text-sm">
      <legend className="flex items-center gap-1 px-1">
        <Bell className="size-4" />
        提醒时间
      </legend>
      <select
        aria-label="提醒方式"
        className={selectClass}
        value={mode}
        onChange={(event) => {
          const mode = event.target.value
          if (mode === "none") onChange(null)
          else if (mode === "once")
            onChange({
              mode: "once",
              at: new Date(`${shanghaiNow}:00+08:00`).toISOString(),
              timezone: "Asia/Shanghai",
            })
          else
            onChange({
              mode: "recurring",
              frequency: "daily",
              time: "09:00",
              timezone: "Asia/Shanghai",
            })
        }}
      >
        <option value="none">不提醒</option>
        <option value="once">一次性</option>
        <option value="recurring">重复提醒</option>
      </select>
      {value?.mode === "once" && (
        <Field label="北京时间">
          <Input
            type="datetime-local"
            value={new Date(new Date(value.at).getTime() + 8 * 60 * 60_000)
              .toISOString()
              .slice(0, 16)}
            onChange={(event) => {
              if (event.target.value)
                onChange({ ...value, at: new Date(`${event.target.value}:00+08:00`).toISOString() })
            }}
          />
        </Field>
      )}
      {value?.mode === "recurring" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="重复周期">
            <select
              className={selectClass}
              value={value.frequency}
              onChange={(event) =>
                onChange({
                  mode: "recurring",
                  frequency: event.target.value as "daily" | "weekly" | "monthly",
                  time: value.time,
                  timezone: "Asia/Shanghai",
                  ...(event.target.value === "weekly" ? { weekdays: [1] } : {}),
                  ...(event.target.value === "monthly" ? { dayOfMonth: 1 } : {}),
                })
              }
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </Field>
          <Field label="提醒时间">
            <Input
              type="time"
              value={value.time}
              onChange={(event) => onChange({ ...value, time: event.target.value })}
            />
          </Field>
          {value.frequency === "weekly" && (
            <div className="col-span-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <label key={day} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={value.weekdays?.includes(day) ?? false}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        weekdays: event.target.checked
                          ? [...(value.weekdays ?? []), day].sort()
                          : (value.weekdays ?? []).filter((item) => item !== day),
                      })
                    }
                  />
                  {["一", "二", "三", "四", "五", "六", "日"][day - 1]}
                </label>
              ))}
            </div>
          )}
          {value.frequency === "monthly" && (
            <Field label="每月几号">
              <Input
                type="number"
                min={1}
                max={31}
                value={value.dayOfMonth ?? 1}
                onChange={(event) => onChange({ ...value, dayOfMonth: Number(event.target.value) })}
              />
            </Field>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        到时向当前负责人发送任务卡片 · 时区 Asia/Shanghai
      </p>
    </fieldset>
  )
}
