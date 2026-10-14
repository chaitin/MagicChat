import { useEffect, useRef, useState, type FormEvent } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { CalendarDays, Pencil, Trash2, X } from "lucide-react"
import { zhCN } from "date-fns/locale"
import type {
  DesktopProjectTask,
  ProjectTaskAssignee,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { hasTaskImageUpload } from "../../../shared/task-image"
import { TaskDescriptionEditor } from "./task-description-editor"
import { TaskTextContextMenu } from "./task-text-context-menu"
import { ProjectTaskDetailView } from "./project-task-detail-view"
import {
  taskPropertyMutation,
  taskPropertyValues,
  type TaskPropertyValues,
} from "./task-property-mutation"
import {
  TaskPriorityIcon,
  TaskStatusIcon,
  priorityIconColors,
  statusIconColors,
  taskSelectItemClassName,
} from "./project-task-views"
import { TaskAssigneePicker } from "./task-assignee-picker"
import {
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  formatDateKey,
  isValid24HourTime,
  mergeTaskLabels,
  parseDateKey,
  shanghaiReminderDateTime,
  shanghaiReminderISO,
} from "./task-view-model"

type TaskForm = TaskPropertyValues & {
  title: string
  description: string
  labels: string[]
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
    labels: task?.labels ?? [],
    reminder: task?.reminder ?? null,
  }
}

export function ProjectTaskDialog({
  targetId,
  projectId,
  task: initialTask,
  members,
  resolvedTheme,
  onClose,
  onChanged,
  onTaskSaved,
}: {
  targetId: string
  projectId: string
  task: DesktopProjectTask | null
  members: ProjectTaskAssignee[]
  resolvedTheme: "light" | "dark"
  onClose: () => void
  onChanged: () => Promise<void>
  onTaskSaved: (task: DesktopProjectTask) => void
}) {
  const { showToast } = useAnimatedToast()
  const [task, setTask] = useState(initialTask)
  const savingRef = useRef(false)
  const [activityRevision, setActivityRevision] = useState(0)
  const [form, setForm] = useState<TaskForm>(() => initialForm(task))
  const [labelDraft, setLabelDraft] = useState("")
  const [editing, setEditing] = useState(() => !task)
  const details = task
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current || saving || !editing) return
    setError("")
    const invalid = (message: string) => {
      setError(message)
      showToast({ status: "error", title: "无法保存任务", description: message })
    }
    if (hasTaskImageUpload(form.description))
      return invalid("请等待图片上传完成，失败的图片请重试或移除")
    const title = form.title.trim()
    if (!title) return invalid("请填写任务标题")
    if (form.startDate && form.dueDate && form.startDate > form.dueDate)
      return invalid("开始日期不能晚于截止日期")
    const labels = mergeTaskLabels(form.labels, labelDraft)
    if (labels.length > 20) return invalid("最多添加 20 个标签")
    savingRef.current = true
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
        ? await window.taskWindow!.accountData.updateProjectTask({
            targetId,
            projectId,
            taskId: task.id,
            ...fields,
          })
        : await window.taskWindow!.accountData.createProjectTask({ targetId, projectId, ...fields })
      if (!result.ok) throw new Error(result.error.message)
      if (task) {
        setTask(result.data)
        onTaskSaved(result.data)
        setForm(initialForm(result.data))
        setLabelDraft("")
        setEditing(false)
        setActivityRevision((value) => value + 1)
      }
      showToast({ status: "success", title: task ? "任务修改已保存" : "任务创建成功" })
      await notifyChanged()
      if (!task) onClose()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存任务失败"
      setError(message)
      showToast({ status: "error", title: "保存任务失败", description: message })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function remove() {
    if (!task || saving) return
    setSaving(true)
    setError("")
    try {
      const result = await window.taskWindow!.accountData.deleteProjectTask({
        targetId,
        projectId,
        taskId: task.id,
      })
      if (!result.ok) throw new Error(result.error.message)
      await onChanged()
      onClose()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "删除任务失败"
      setError(message)
      showToast({ status: "error", title: "删除任务失败", description: message })
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  async function notifyChanged() {
    try {
      await onChanged()
    } catch {
      showToast({
        status: "warning",
        title: "任务已保存，但列表刷新失败",
        description: "可重新打开项目列表刷新。",
      })
    }
  }

  async function saveProperty<K extends keyof TaskPropertyValues>(
    key: K,
    value: TaskPropertyValues[K],
  ) {
    if (!task || savingRef.current || editing) return
    try {
      const mutation = taskPropertyMutation(taskPropertyValues(task), key, value)
      if (!mutation) return
      savingRef.current = true
      setSaving(true)
      const result = await window.taskWindow!.accountData.updateProjectTask({
        targetId,
        projectId,
        taskId: task.id,
        ...mutation,
      })
      if (!result.ok) throw new Error(result.error.message)
      setTask(result.data)
      onTaskSaved(result.data)
      setForm(initialForm(result.data))
      setActivityRevision((current) => current + 1)
      showToast({ status: "success", title: "任务修改已保存" })
      await notifyChanged()
    } catch (reason) {
      showToast({
        status: "error",
        title: "修改任务失败",
        description: reason instanceof Error ? reason.message : "请稍后重试",
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function change<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function startEditing() {
    if (saving || savingRef.current) return
    setForm(initialForm(task))
    setLabelDraft("")
    setError("")
    setEditing(true)
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <ScrollArea
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:h-full! [&>div]:w-full! [&>div]:min-w-0!"
        >
          <div
            className={cn(
              "grid min-h-full items-start gap-4 p-5 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]",
              editing ? "md:grid-rows-[minmax(min-content,1fr)]" : "content-start",
            )}
          >
            {!editing && task ? (
              <ProjectTaskDetailView
                targetId={targetId}
                projectId={projectId}
                task={task}
                members={members}
                theme={resolvedTheme}
                onChanged={onChanged}
                onEdit={startEditing}
                onDelete={() => setConfirmDelete(true)}
                disabled={saving}
                activityRevision={activityRevision}
                propertyControls={
                  <TaskPropertyFields
                    targetId={targetId}
                    members={members}
                    values={taskPropertyValues(task)}
                    task={task}
                    theme={resolvedTheme}
                    disabled={saving}
                    hideEmpty
                    onChange={(key, value) => void saveProperty(key, value)}
                  />
                }
              />
            ) : (
              <form
                id="project-task-form"
                className="contents"
                onSubmit={(event) => void save(event)}
              >
                <div className="grid min-w-0 gap-3 md:col-start-1 md:row-start-1 md:grid-rows-[auto_auto_minmax(min-content,1fr)] md:self-stretch">
                  <Field label="标题">
                    <TaskTextContextMenu editable disabled={saving}>
                      <Input
                        autoFocus
                        required
                        maxLength={240}
                        value={form.title}
                        disabled={saving}
                        onChange={(event) => change("title", event.target.value)}
                      />
                    </TaskTextContextMenu>
                  </Field>
                  <Field label="标签" interactive>
                    <TaskLabelInput
                      labels={form.labels}
                      draft={labelDraft}
                      disabled={saving}
                      onDraftChange={setLabelDraft}
                      onAdd={() => {
                        const labels = mergeTaskLabels(form.labels, labelDraft)
                        if (labels.length > 20) {
                          setError("最多添加 20 个标签")
                          return
                        }
                        change("labels", labels)
                        setLabelDraft("")
                      }}
                      onRemove={(label) =>
                        change(
                          "labels",
                          form.labels.filter((item) => item !== label),
                        )
                      }
                    />
                  </Field>
                  <TaskDescriptionEditor
                    targetId={targetId}
                    projectId={projectId}
                    taskId={task?.id}
                    value={form.description}
                    disabled={saving}
                    onChange={(update) =>
                      setForm((current) => ({
                        ...current,
                        description: update(current.description),
                      }))
                    }
                  />
                </div>
                <div className="grid min-w-0 content-start gap-3 md:col-start-2 md:row-start-1">
                  <TaskPropertyFields
                    targetId={targetId}
                    members={members}
                    values={form}
                    task={details}
                    theme={resolvedTheme}
                    disabled={saving}
                    onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
                  />
                </div>
              </form>
            )}
          </div>
        </ScrollArea>
        {editing && (
          <div className="grid shrink-0 gap-3 border-t bg-background px-5 py-3">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {task && (
                <Button
                  type="button"
                  variant="destructive"
                  className="mr-auto"
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 />
                  删除
                </Button>
              )}
              {editing && task && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setForm(initialForm(task))
                    setLabelDraft("")
                    setError("")
                    setEditing(false)
                  }}
                >
                  退出编辑
                </Button>
              )}
              {editing ? (
                <Button
                  type="submit"
                  form="project-task-form"
                  disabled={saving || hasTaskImageUpload(form.description) || !form.title.trim()}
                >
                  {saving ? "保存中…" : task ? "保存修改" : "创建任务"}
                </Button>
              ) : (
                <Button type="button" disabled={saving} onClick={startEditing}>
                  <Pencil />
                  编辑
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!saving) setConfirmDelete(open)
        }}
      >
        <AlertDialogContent size="sm">
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
    </>
  )
}

function TaskPropertyFields({
  targetId,
  members,
  values,
  task,
  theme,
  disabled,
  hideEmpty = false,
  onChange,
}: {
  targetId: string
  members: ProjectTaskAssignee[]
  values: TaskPropertyValues
  task: DesktopProjectTask | null
  theme: "light" | "dark"
  disabled: boolean
  hideEmpty?: boolean
  onChange: <K extends keyof TaskPropertyValues>(key: K, value: TaskPropertyValues[K]) => void
}) {
  const assigneeName =
    members.find((member) => member.id === values.assigneeUserId)?.displayName ||
    task?.assignee?.nickname ||
    task?.assignee?.name ||
    "未知成员"
  return (
    <fieldset disabled={disabled} className="contents">
      <Field label="状态" interactive>
        <Select
          value={values.status}
          disabled={disabled}
          onValueChange={(status) => onChange("status", status as ProjectTaskStatus)}
        >
          <SelectTrigger className="w-full" aria-label="状态">
            <SelectValue>
              <TaskStatusIcon status={values.status} />
              {taskStatusLabels[values.status]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            {taskStatuses.map((status) => (
              <SelectItem
                key={status}
                value={status}
                className={taskSelectItemClassName}
                indicatorClassName={statusIconColors[status]}
              >
                <TaskStatusIcon status={status} />
                {taskStatusLabels[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="优先级" interactive>
        <Select
          value={String(values.priority)}
          disabled={disabled}
          onValueChange={(priority) =>
            onChange("priority", Number(priority) as ProjectTaskPriority)
          }
        >
          <SelectTrigger className="w-full" aria-label="优先级">
            <SelectValue>
              <TaskPriorityIcon priority={values.priority} />
              {taskPriorityLabels[values.priority]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            {taskPriorities.map((priority) => (
              <SelectItem
                key={priority}
                value={String(priority)}
                className={taskSelectItemClassName}
                indicatorClassName={priorityIconColors[priority]}
              >
                <TaskPriorityIcon priority={priority} />
                {taskPriorityLabels[priority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {(!hideEmpty || values.assigneeUserId) && (
        <Field label="负责人" interactive>
          <TaskAssigneePicker
            targetId={targetId}
            members={members}
            value={values.assigneeUserId}
            name={assigneeName}
            theme={theme}
            disabled={disabled}
            onChange={(id) => onChange("assigneeUserId", id)}
          />
        </Field>
      )}
      {(!hideEmpty || values.startDate) && (
        <Field label="开始日期" interactive>
          <TaskDatePicker
            label="开始日期"
            value={values.startDate}
            disabled={disabled}
            onChange={(date) => onChange("startDate", date)}
          />
        </Field>
      )}
      {(!hideEmpty || values.dueDate) && (
        <Field label="截止日期" interactive>
          <TaskDatePicker
            label="截止日期"
            value={values.dueDate}
            disabled={disabled}
            onChange={(date) => onChange("dueDate", date)}
          />
        </Field>
      )}
      {(!hideEmpty || values.reminder) && (
        <TaskReminderField
          value={values.reminder}
          disabled={disabled}
          onChange={(value) => onChange("reminder", value)}
        />
      )}
      {task?.reminder && (
        <p className="text-xs text-muted-foreground">
          提醒状态：
          {
            { scheduled: "已安排", paused: "已暂停", fired: "已触发", expired: "已过期" }[
              task.reminder.state
            ]
          }
          {task.reminder.nextTriggerAt
            ? ` · 下次提醒 ${new Date(task.reminder.nextTriggerAt).toLocaleString("zh-CN")}`
            : ""}
        </p>
      )}
    </fieldset>
  )
}

function TaskLabelInput({
  labels,
  draft,
  disabled,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  labels: string[]
  draft: string
  disabled: boolean
  onDraftChange: (value: string) => void
  onAdd: () => void
  onRemove: (label: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      role="group"
      aria-label="标签"
      className={cn(
        "flex min-h-9 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus()
      }}
    >
      {labels.map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="h-6 max-w-full gap-1 border-sky-300 bg-sky-100 text-sky-600 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
        >
          <span className="truncate" title={label}>
            {label}
          </span>
          <button
            type="button"
            aria-label={`删除标签 ${label}`}
            disabled={disabled}
            className="flex size-4 shrink-0 items-center justify-center rounded-full text-current hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
            onClick={() => {
              onRemove(label)
              inputRef.current?.focus()
            }}
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <Input
        ref={inputRef}
        aria-label="添加标签"
        value={draft}
        maxLength={64}
        disabled={disabled}
        placeholder="输入后按回车添加"
        className="h-6 min-w-28 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === "Enter") {
            event.preventDefault()
            onAdd()
          } else if (event.key === "Backspace" && !draft && labels.length) {
            event.preventDefault()
            onRemove(labels[labels.length - 1])
          }
        }}
      />
    </div>
  )
}

function Field({
  label,
  children,
  interactive = false,
  className,
}: {
  label: string
  children: React.ReactNode
  interactive?: boolean
  className?: string
}) {
  const content = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </>
  )
  return interactive ? (
    <div className={cn("grid min-w-0 gap-1 text-sm", className)}>{content}</div>
  ) : (
    <label className={cn("grid min-w-0 gap-1 text-sm", className)}>{content}</label>
  )
}

function TaskDatePicker({
  label,
  value,
  disabled,
  clearable = true,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  clearable?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          aria-label={label}
          disabled={disabled}
        >
          <CalendarDays className="size-4" aria-hidden />
          {value || "选择日期"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={parseDateKey(value) ?? undefined}
          defaultMonth={parseDateKey(value) ?? new Date()}
          onSelect={(date) => {
            if (date) {
              onChange(formatDateKey(date))
              setOpen(false)
            }
          }}
        />
        {value && clearable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="m-2 mt-0 self-end"
            onClick={() => {
              onChange("")
              setOpen(false)
            }}
          >
            清除日期
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function TimeInput24Hour({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  function commit() {
    if (isValid24HourTime(draft)) {
      if (draft !== value) {
        setDraft(value)
        onChange(draft)
      }
    } else {
      setDraft(value)
    }
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      maxLength={5}
      placeholder="HH:mm"
      className="bg-background tabular-nums"
      aria-label="24 小时制提醒时间"
      aria-invalid={draft.length > 0 && !isValid24HourTime(draft)}
      value={draft}
      onChange={(event) => {
        const input = event.target.value
        setDraft(/^\d{4}$/.test(input) ? `${input.slice(0, 2)}:${input.slice(2)}` : input)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function TaskReminderDayInput({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled: boolean
  onChange: (day: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <Input
      type="number"
      min={1}
      max={31}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const day = Number(draft)
        setDraft(String(value))
        if (Number.isInteger(day) && day >= 1 && day <= 31 && day !== value) onChange(day)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function TaskReminderField({
  value,
  disabled,
  onChange,
}: {
  value: ProjectTaskReminderInput | null
  disabled: boolean
  onChange: (value: ProjectTaskReminderInput | null) => void
}) {
  const mode = value?.mode ?? "none"
  const shanghaiNow = new Date(Date.now() + 8 * 60 * 60_000 + 60_000).toISOString().slice(0, 16)
  return (
    <div role="group" aria-label="任务提醒" className="grid gap-1 text-sm">
      <Label htmlFor="task-reminder-mode" className="cursor-pointer text-xs text-muted-foreground">
        任务提醒
      </Label>
      <Select
        value={mode}
        disabled={disabled}
        onValueChange={(nextMode) => {
          if (nextMode === "none") onChange(null)
          else if (nextMode === "once")
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
        <SelectTrigger id="task-reminder-mode" className="w-full" aria-label="提醒方式">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem className={taskSelectItemClassName} value="none">
            不提醒
          </SelectItem>
          <SelectItem className={taskSelectItemClassName} value="once">
            一次性
          </SelectItem>
          <SelectItem className={taskSelectItemClassName} value="recurring">
            重复提醒
          </SelectItem>
        </SelectContent>
      </Select>
      {value?.mode === "once" && (
        <div className="grid gap-2">
          <Field label="提醒日期（北京时间）" interactive>
            <TaskDatePicker
              label="提醒日期"
              disabled={disabled}
              clearable={false}
              value={shanghaiReminderDateTime(value.at).date}
              onChange={(date) => {
                if (date)
                  onChange({
                    ...value,
                    at: shanghaiReminderISO(date, shanghaiReminderDateTime(value.at).time),
                  })
              }}
            />
          </Field>
          <Field label="提醒时间（北京时间）">
            <TimeInput24Hour
              value={shanghaiReminderDateTime(value.at).time}
              disabled={disabled}
              onChange={(time) =>
                onChange({
                  ...value,
                  at: shanghaiReminderISO(shanghaiReminderDateTime(value.at).date, time),
                })
              }
            />
          </Field>
        </div>
      )}
      {value?.mode === "recurring" && (
        <div className="grid gap-2">
          <Field label="重复周期" interactive>
            <Select
              value={value.frequency}
              disabled={disabled}
              onValueChange={(frequency) =>
                onChange({
                  mode: "recurring",
                  frequency: frequency as "daily" | "weekly" | "monthly",
                  time: value.time,
                  timezone: "Asia/Shanghai",
                  ...(frequency === "weekly" ? { weekdays: [1] } : {}),
                  ...(frequency === "monthly" ? { dayOfMonth: 1 } : {}),
                })
              }
            >
              <SelectTrigger className="w-full" aria-label="重复周期">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem className={taskSelectItemClassName} value="daily">
                  每天
                </SelectItem>
                <SelectItem className={taskSelectItemClassName} value="weekly">
                  每周
                </SelectItem>
                <SelectItem className={taskSelectItemClassName} value="monthly">
                  每月
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="提醒时间">
            <TimeInput24Hour
              value={value.time}
              disabled={disabled}
              onChange={(time) => onChange({ ...value, time })}
            />
          </Field>
          {value.frequency === "weekly" && (
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <label key={day} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    disabled={disabled}
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
              <TaskReminderDayInput
                disabled={disabled}
                value={value.dayOfMonth ?? 1}
                onChange={(dayOfMonth) => onChange({ ...value, dayOfMonth })}
              />
            </Field>
          )}
        </div>
      )}
    </div>
  )
}
