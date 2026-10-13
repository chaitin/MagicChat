import { useEffect, useMemo, useState, type FormEvent } from "react"
import { CalendarDays, MessageSquare, Trash2 } from "lucide-react"
import { zhCN } from "date-fns/locale"
import type {
  DesktopProjectTask,
  ProjectTaskAssignee,
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
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  TaskPriorityIcon,
  TaskStatusIcon,
  priorityIconColors,
  statusIconColors,
  taskSelectItemClassName,
} from "./project-task-views"
import {
  createUserSearchIndex,
  matchesUserSearch,
  type UserSearchIndex,
} from "../../../shared/user-search"
import {
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  formatDateKey,
  isValid24HourTime,
  parseDateKey,
  shanghaiReminderDateTime,
  shanghaiReminderISO,
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
  resolvedTheme,
  onClose,
  onChanged,
}: {
  targetId: string
  projectId: string
  task: DesktopProjectTask | null
  members: ProjectTaskAssignee[]
  resolvedTheme: "light" | "dark"
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [form, setForm] = useState<TaskForm>(() => initialForm(task))
  const details = task
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
      const result = await window.taskWindow!.accountData.listProjectTaskActivities({
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
      .taskWindow!.accountData.listProjectTaskActivities({ targetId, projectId, taskId: task.id })
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
    if (saving) return
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
        ? await window.taskWindow!.accountData.updateProjectTask({
            targetId,
            projectId,
            taskId: task.id,
            ...fields,
          })
        : await window.taskWindow!.accountData.createProjectTask({ targetId, projectId, ...fields })
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
      const result = await window.taskWindow!.accountData.deleteProjectTask({
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
      const result = await window.taskWindow!.accountData.addProjectTaskComment({
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

  const assigneeName =
    members.find((member) => member.id === form.assigneeUserId)?.displayName ||
    task?.assignee?.nickname ||
    task?.assignee?.name ||
    "未知成员"

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid items-start gap-4 p-5 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] md:grid-rows-[auto_1fr]">
            <form
              id="project-task-form"
              className="contents"
              onSubmit={(event) => void save(event)}
            >
              <div className="grid min-w-0 gap-4 md:col-start-1 md:row-start-1">
                <Field label="任务标题">
                  <Input
                    autoFocus
                    required
                    maxLength={240}
                    value={form.title}
                    disabled={saving}
                    onChange={(event) => change("title", event.target.value)}
                  />
                </Field>
                <Field label="标签（逗号分隔）">
                  <Input
                    value={form.labels}
                    disabled={saving}
                    onChange={(event) => change("labels", event.target.value)}
                    placeholder="例如：发版, 设计"
                  />
                </Field>
                <Field label="任务描述">
                  <Textarea
                    className="min-h-24"
                    value={form.description}
                    disabled={saving}
                    onChange={(event) => change("description", event.target.value)}
                  />
                </Field>
              </div>
              <div className="grid min-w-0 content-start gap-3 md:col-start-2 md:row-start-1 md:row-span-2">
                <Field label="状态" interactive>
                  <Select
                    value={form.status}
                    disabled={saving}
                    onValueChange={(status) => change("status", status as ProjectTaskStatus)}
                  >
                    <SelectTrigger className="w-full" aria-label="状态">
                      <SelectValue>
                        <TaskStatusIcon status={form.status} />
                        {taskStatusLabels[form.status]}
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
                    value={String(form.priority)}
                    disabled={saving}
                    onValueChange={(priority) =>
                      change("priority", Number(priority) as ProjectTaskPriority)
                    }
                  >
                    <SelectTrigger className="w-full" aria-label="优先级">
                      <SelectValue>
                        <TaskPriorityIcon priority={form.priority} />
                        {taskPriorityLabels[form.priority]}
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
                <Field label="负责人" interactive>
                  <TaskAssigneePicker
                    targetId={targetId}
                    members={members}
                    value={form.assigneeUserId}
                    name={assigneeName}
                    theme={resolvedTheme}
                    disabled={saving}
                    onChange={(id) => change("assigneeUserId", id)}
                  />
                </Field>
                <Field label="开始日期" interactive>
                  <TaskDatePicker
                    label="开始日期"
                    value={form.startDate}
                    disabled={saving}
                    onChange={(date) => change("startDate", date)}
                  />
                </Field>
                <Field label="截止日期" interactive>
                  <TaskDatePicker
                    label="截止日期"
                    value={form.dueDate}
                    disabled={saving}
                    onChange={(date) => change("dueDate", date)}
                  />
                </Field>
                <TaskReminderField
                  value={form.reminder}
                  onChange={(value) => change("reminder", value)}
                />
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
              </div>
            </form>
            {task && (
              <div className="grid min-w-0 gap-4 md:col-start-1 md:row-start-2">
                {details && (
                  <p className="text-xs text-muted-foreground">
                    创建人：{details.creator.nickname || details.creator.name || details.creator.id}
                    {` · 创建于 ${new Date(details.createdAt).toLocaleString("zh-CN")}`}
                    {` · 更新于 ${new Date(details.updatedAt).toLocaleString("zh-CN")}`}
                  </p>
                )}
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
              </div>
            )}
          </div>
        </div>
        <div className="grid shrink-0 gap-3 border-t bg-background px-5 py-4">
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
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form="project-task-form" disabled={saving || !form.title.trim()}>
              {saving ? "保存中…" : task ? "保存修改" : "创建任务"}
            </Button>
          </div>
        </div>
      </div>
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
    </>
  )
}

function TaskAssigneePicker({
  targetId,
  members,
  value,
  name,
  theme,
  disabled,
  onChange,
}: {
  targetId: string
  members: ProjectTaskAssignee[]
  value: string
  name: string
  theme: "light" | "dark"
  disabled: boolean
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const options = useMemo(() => {
    const createOption = (
      id: string,
      label: string,
      fields: Parameters<typeof createUserSearchIndex>[0],
    ) => ({ id, name: label, searchIndex: createUserSearchIndex(fields) })
    const items = [
      createOption("", "未分配", {
        displayName: "未分配",
        name: "",
        nickname: "",
        email: "",
        phone: "",
      }),
      ...members
        .filter((member) => member.status === "active")
        .map((member) => createOption(member.id, member.displayName, member)),
    ]
    if (value && !items.some((option) => option.id === value)) {
      items.splice(
        1,
        0,
        createOption(value, name, { displayName: name, name, nickname: "", email: "", phone: "" }),
      )
    }
    return items
  }, [members, value, name])

  return (
    <Combobox
      items={options}
      filter={(option: { searchIndex: UserSearchIndex }, input) =>
        matchesUserSearch(option.searchIndex, input)
      }
      value={options.find((option) => option.id === value)}
      onValueChange={(option) => onChange(option?.id ?? "")}
      itemToStringLabel={(option) => option.name}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, selected) => option.id === selected.id}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-label="负责人"
        className="flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-sm font-normal shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        {value ? (
          <TaskAssignee targetId={targetId} userId={value} name={name} theme={theme} />
        ) : (
          "未分配"
        )}
      </ComboboxTrigger>
      <ComboboxContent className="min-w-(--anchor-width)">
        <ComboboxInput
          placeholder="姓名、昵称、邮箱或手机号"
          aria-label="搜索负责人"
          showTrigger={false}
        />
        <ComboboxEmpty>未找到匹配的负责人</ComboboxEmpty>
        <ComboboxList>
          {(option: { id: string; name: string }) => (
            <ComboboxItem key={option.id} value={option}>
              {option.id ? (
                <TaskAssignee
                  targetId={targetId}
                  userId={option.id}
                  name={option.name}
                  theme={theme}
                />
              ) : (
                option.name
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function TaskAssignee({
  targetId,
  userId,
  name,
  theme,
}: {
  targetId: string
  userId: string
  name: string
  theme: "light" | "dark"
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EntityAvatar
        targetId={targetId}
        type="user"
        id={userId}
        theme={theme}
        size={20}
        label={`${name}头像`}
      />
      <span className="truncate">{name}</span>
    </span>
  )
}

function Field({
  label,
  children,
  interactive = false,
}: {
  label: string
  children: React.ReactNode
  interactive?: boolean
}) {
  const content = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </>
  )
  return interactive ? (
    <div className="grid min-w-0 gap-1 text-sm">{content}</div>
  ) : (
    <label className="grid min-w-0 gap-1 text-sm">{content}</label>
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
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  function commit() {
    if (isValid24HourTime(draft)) {
      if (draft !== value) onChange(draft)
    } else {
      setDraft(value)
    }
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
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
      <legend className="px-1">
        <Label
          htmlFor="task-reminder-mode"
          className="cursor-pointer text-xs text-muted-foreground"
        >
          任务提醒
        </Label>
      </legend>
      <Select
        value={mode}
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
            <TimeInput24Hour value={value.time} onChange={(time) => onChange({ ...value, time })} />
          </Field>
          {value.frequency === "weekly" && (
            <div className="flex flex-wrap gap-2">
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
    </fieldset>
  )
}
