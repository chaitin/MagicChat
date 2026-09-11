import * as React from "react"
import {
  ArrowLeft,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Ellipsis,
  Equal,
  Eye,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { ProjectMemberCombobox } from "@/components/projects/project-member-combobox"
import { ProjectTaskActivityFeed } from "@/components/projects/project-task-activity-feed"
import { ProjectTaskDatePicker } from "@/components/projects/project-task-date-picker"
import { ProjectTaskLabelsCombobox } from "@/components/projects/project-task-labels-combobox"
import { ProjectTaskReminderField } from "@/components/projects/project-task-reminder-field"
import {
  SendCardDialog,
  StandaloneEntityCardDialog,
} from "@/components/conversation/send-card-dialog"
import { MessageMarkdown } from "@/components/message-markdown"
import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskReminderInput,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClientProjectMember } from "@/lib/project-data-api"
import {
  useOptionalClientData,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import {
  hydrateClientProjectMembers,
  listAllClientProjectMembers,
} from "@/lib/project-members"
import {
  deleteClientProjectTask,
  getClientProjectTask,
  listClientProjectTasks,
  type UpdateClientProjectTaskInput,
  updateClientProjectTask,
} from "@/lib/project-task-data-api"

const emptyTaskDetailsUsersById: ClientDataContextValue["usersById"] = {}

type TaskEditForm = {
  assigneeUserId: string
  description: string
  dueDate: string
  labels: string[]
  priority: ProjectTaskPriority
  reminder: ProjectTaskReminderInput | null
  startDate: string
  status: ProjectTaskStatus
  title: string
}

type NormalizedTaskEditForm = {
  assigneeUserId: string | null
  description: string
  dueDate: string | null
  labels: string[]
  priority: ProjectTaskPriority
  reminder: ProjectTaskReminderInput | null
  startDate: string | null
  status: ProjectTaskStatus
  title: string
}

export function ProjectTaskDetailsDialog({
  embedded = false,
  onDeleted,
  onOpenChange,
  onUpdated,
  open,
  task,
}: {
  embedded?: boolean
  onDeleted?: (taskId: string) => void
  onOpenChange: (open: boolean) => void
  onUpdated?: () => Promise<void>
  open: boolean
  task: ProjectTask
}) {
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const usersById = clientData?.usersById ?? emptyTaskDetailsUsersById
  const initialForm = createTaskEditForm(task)
  const [baseline, setBaseline] = React.useState<NormalizedTaskEditForm>(() =>
    normalizeTaskEditForm(initialForm)
  )
  const [storedDetails, setDetails] = React.useState(task)
  const details = React.useMemo(
    () => hydrateTaskDetailsUser(storedDetails, usersById),
    [storedDetails, usersById]
  )
  const [descriptionEditing, setDescriptionEditing] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState("")
  const [form, setForm] = React.useState<TaskEditForm>(initialForm)
  const [loading, setLoading] = React.useState(true)
  const [labelOptions, setLabelOptions] = React.useState<string[]>([])
  const [labelsError, setLabelsError] = React.useState("")
  const [labelsLoading, setLabelsLoading] = React.useState(true)
  const [storedMembers, setMembers] = React.useState<ClientProjectMember[]>([])
  const members = React.useMemo(
    () => hydrateClientProjectMembers(storedMembers, usersById),
    [storedMembers, usersById]
  )
  const [membersError, setMembersError] = React.useState("")
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState(task.title)
  const [titleEditing, setTitleEditing] = React.useState(false)
  const [titleSaving, setTitleSaving] = React.useState(false)
  const assigneeComboboxPortal = React.useRef<HTMLDivElement | null>(null)
  const savingRef = React.useRef(false)
  const assigneeNames = React.useMemo(
    () =>
      Object.fromEntries(
        members.map((member) => [member.id, member.displayName])
      ),
    [members]
  )

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void getClientProjectTask(task.projectId, task.id)
      .then(async (nextDetails) => {
        if (ensureUsers) {
          await ensureUsers([
            nextDetails.creator.id,
            ...(nextDetails.assignee ? [nextDetails.assignee.id] : []),
          ])
        }
        if (!active) {
          return
        }
        const loadedForm = createTaskEditForm(nextDetails)
        setBaseline(normalizeTaskEditForm(loadedForm))
        setDetails(nextDetails)
        setDescriptionEditing(false)
        setForm(loadedForm)
        setTitleDraft(nextDetails.title)
        setTitleEditing(false)
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "加载任务详情失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    void listAllClientProjectMembers(task.projectId)
      .then(async (nextMembers) => {
        if (ensureUsers) {
          await ensureUsers(nextMembers.map((member) => member.id))
        }
        return nextMembers
      })
      .then((nextMembers) => {
        if (active) {
          setMembers(nextMembers.filter((member) => member.status === "active"))
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setMembersError(
            loadError instanceof Error ? loadError.message : "加载项目成员失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setMembersLoading(false)
        }
      })

    void listAllProjectTaskLabels(task.projectId, task.id)
      .then((nextLabels) => {
        if (active) {
          setLabelOptions(nextLabels)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setLabelsError(
            loadError instanceof Error ? loadError.message : "加载候选标签失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setLabelsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [ensureUsers, open, task.id, task.projectId])

  const normalizedForm = normalizeTaskEditForm(form)
  const validationError = getTaskEditValidationError(normalizedForm)
  const descriptionDirty = form.description !== baseline.description
  const fallbackAssignee = createFallbackProjectMember(details)
  const memberOptions =
    fallbackAssignee &&
    !members.some((member) => member.id === fallbackAssignee.id)
      ? [fallbackAssignee, ...members]
      : members
  const selectedAssignee = memberOptions.find(
    (member) => member.id === form.assigneeUserId
  )
  const card = {
    entityId: details.id,
    entityType: "task",
    type: "entity_card",
  } as const

  function updateForm<K extends keyof TaskEditForm>(
    field: K,
    value: TaskEditForm[K]
  ) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function saveImmediateField<K extends keyof TaskEditForm>(
    field: K,
    value: TaskEditForm[K],
    input: UpdateClientProjectTaskInput,
    successMessage: string
  ) {
    if (savingRef.current || titleSaving || deleting) return
    const nextForm = { ...form, [field]: value }
    const nextNormalized = normalizeTaskEditForm(nextForm)
    const validationMessage = getTaskEditValidationError(nextNormalized)
    if (validationMessage) {
      toast.error(validationMessage)
      return
    }
    setForm(nextForm)
    const comparison = {
      ...baseline,
      [field]: nextNormalized[field],
    }
    if (taskEditFormsEqual(comparison, baseline)) return
    void persistTaskFields(input, [field], successMessage, form)
  }

  async function persistTaskFields(
    input: UpdateClientProjectTaskInput,
    fields: Array<keyof TaskEditForm>,
    successMessage: string,
    previousForm = form
  ) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const toastId = toast.loading("正在保存修改")
    try {
      const updatedTask = await updateClientProjectTask(
        task.projectId,
        task.id,
        input
      )
      const updatedForm = createTaskEditForm(updatedTask)
      const updatedNormalized = normalizeTaskEditForm(updatedForm)
      setBaseline((current) =>
        mergeTaskEditFields(current, updatedNormalized, fields)
      )
      setDetails(updatedTask)
      setError("")
      setForm((current) => mergeTaskEditFields(current, updatedForm, fields))
      toast.success(successMessage, { id: toastId })
      await onUpdated?.()
    } catch (saveError) {
      setForm((current) => mergeTaskEditFields(current, previousForm, fields))
      toast.error(
        saveError instanceof Error ? saveError.message : "保存任务失败",
        { id: toastId }
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving || titleSaving || deleting) {
      return
    }
    if (!nextOpen) {
      const resetForm = createTaskEditForm(details)
      setBaseline(normalizeTaskEditForm(resetForm))
      setDescriptionEditing(false)
      setDeleteDialogOpen(false)
      setError("")
      setForm(resetForm)
      setLoading(true)
      setLabelOptions([])
      setLabelsError("")
      setLabelsLoading(true)
      setMembers([])
      setMembersError("")
      setMembersLoading(true)
      setSendDialogOpen(false)
      setTitleDraft(details.title)
      setTitleEditing(false)
    }
    onOpenChange(nextOpen)
  }

  function saveDescription() {
    if (!descriptionDirty || savingRef.current) return
    void persistTaskFields(
      { description: form.description },
      ["description"],
      "详细内容已保存"
    )
  }

  async function saveTitle() {
    if (titleSaving) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      toast.error("任务标题不能为空")
      setTitleDraft(form.title)
      setTitleEditing(false)
      return
    }
    if (Array.from(nextTitle).length > 240) {
      toast.error("标题长度不能超过 240 个字符")
      return
    }
    if (nextTitle === baseline.title) {
      setTitleDraft(baseline.title)
      setForm((current) => ({ ...current, title: baseline.title }))
      setTitleEditing(false)
      return
    }

    setTitleSaving(true)
    const toastId = toast.loading("正在修改任务标题")
    try {
      const updatedTask = await updateClientProjectTask(
        task.projectId,
        task.id,
        { title: nextTitle }
      )
      const savedTitle = updatedTask.title.trim()
      setBaseline((current) => ({ ...current, title: savedTitle }))
      setDetails(updatedTask)
      setForm((current) => ({ ...current, title: savedTitle }))
      setTitleDraft(savedTitle)
      setTitleEditing(false)
      toast.success("任务标题已修改", { id: toastId })
      await onUpdated?.()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "修改任务标题失败",
        { id: toastId }
      )
    } finally {
      setTitleSaving(false)
    }
  }

  async function handleDelete() {
    if (deleting) {
      return
    }

    setDeleting(true)
    let deletedTaskId: string
    try {
      deletedTaskId = await deleteClientProjectTask(task.projectId, task.id)
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error ? deleteError.message : "删除任务失败"
      )
      setDeleting(false)
      return
    }

    setDeleting(false)
    toast.success("任务已删除")
    setDeleteDialogOpen(false)
    onOpenChange(false)
    onDeleted?.(deletedTaskId)
  }

  return (
    <Dialog
      modal={!embedded}
      onOpenChange={(nextOpen) => {
        if (!embedded) handleOpenChange(nextOpen)
      }}
      open={open}
    >
      <DialogContent
        className={
          embedded
            ? "h-full w-full flex-1 content-start gap-5 overflow-y-auto bg-background p-4 sm:p-6"
            : "max-h-[85vh] gap-5 overflow-y-auto sm:max-w-5xl"
        }
        embedded={embedded}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={!embedded}
      >
        <DialogHeader
          className={
            embedded
              ? "-mx-4 -mt-4 grid! h-14 shrink-0 items-center border-b px-4 sm:-mx-6 sm:-mt-6 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-6"
              : undefined
          }
        >
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {embedded && (
              <Button
                aria-label="返回任务列表"
                className="md:hidden"
                onClick={() => handleOpenChange(false)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeft />
              </Button>
            )}
            {titleEditing ? (
              <Input
                aria-label="编辑任务标题"
                autoFocus
                className="h-9 min-w-0 flex-1 text-base font-medium"
                disabled={loading || deleting}
                maxLength={240}
                onBlur={() => void saveTitle()}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    setTitleDraft(form.title)
                    setTitleEditing(false)
                  }
                }}
                value={titleDraft}
              />
            ) : (
              <button
                className="w-fit max-w-full min-w-0 truncate py-1.5 text-left hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                disabled={loading || saving || titleSaving || deleting}
                onClick={() => setTitleEditing(true)}
                title="点击修改任务标题"
                type="button"
              >
                {form.title}
              </button>
            )}
            {(loading || titleSaving) && <Spinner />}
          </DialogTitle>
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="更多任务操作"
                  disabled={
                    loading || saving || titleEditing || titleSaving || deleting
                  }
                  size="icon-sm"
                  title="更多任务操作"
                  type="button"
                  variant="ghost"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={descriptionDirty || Boolean(error)}
                  onSelect={() => {
                    requestAnimationFrame(() => setSendDialogOpen(true))
                  }}
                >
                  <Send />
                  发送到对话
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setDeleteDialogOpen(true)}
                  variant="destructive"
                >
                  <Trash2 />
                  删除任务
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DialogDescription className="sr-only">
            查看并修改任务详情。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            <div className="grid min-w-0 content-start gap-5">
              <TaskField
                action={
                  <div className="flex shrink-0 items-center gap-2">
                    {descriptionDirty && (
                      <Button
                        disabled={saving || Boolean(validationError)}
                        onClick={saveDescription}
                        size="xs"
                        type="button"
                      >
                        {saving && <Spinner />}
                        保存
                      </Button>
                    )}
                    <ToggleGroup
                      aria-label="详细内容显示模式"
                      className="shrink-0"
                      disabled={loading || saving}
                      onValueChange={(value) => {
                        if (value) {
                          setDescriptionEditing(value === "source")
                        }
                      }}
                      spacing={0}
                      type="single"
                      value={descriptionEditing ? "source" : "preview"}
                      variant="outline"
                    >
                      <ToggleGroupItem
                        aria-label="显示渲染结果"
                        className="h-6 min-w-0 px-2 data-[state=off]:text-muted-foreground"
                        title="预览"
                        value="preview"
                      >
                        <Eye className="size-3.5" />
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        aria-label="显示 Markdown 原文"
                        className="h-6 min-w-0 px-2 data-[state=off]:text-muted-foreground"
                        title="编辑原文"
                        value="source"
                      >
                        <Pencil className="size-3.5" />
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                }
                htmlFor={
                  descriptionEditing ? "task-details-description" : undefined
                }
                label="详细内容"
              >
                {descriptionEditing ? (
                  <Textarea
                    autoFocus
                    className="field-sizing-fixed h-[60vh] max-h-[60vh] min-h-[60vh] resize-none font-mono!"
                    disabled={loading || saving}
                    id="task-details-description"
                    onChange={(event) =>
                      updateForm("description", event.target.value)
                    }
                    placeholder="支持 Markdown"
                    value={form.description}
                  />
                ) : (
                  <div
                    className="rounded-md border border-input bg-transparent text-sm shadow-xs dark:bg-input/30"
                    data-slot="task-description-preview"
                  >
                    <div className="px-2.5 py-2 contain-content">
                      {form.description.trim() ? (
                        <MessageMarkdown content={form.description} />
                      ) : (
                        <span className="text-muted-foreground">
                          暂无详细内容
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </TaskField>

              <ProjectTaskActivityFeed
                assigneeNames={assigneeNames}
                disabled={loading || saving || deleting}
                projectId={task.projectId}
                revision={details.updatedAt}
                taskId={task.id}
              />
            </div>

            <div className="grid min-w-0 content-start gap-5">
              <div className="grid gap-4">
                <TaskField label="标签">
                  <ProjectTaskLabelsCombobox
                    disabled={loading || saving}
                    loading={labelsLoading}
                    onValueChange={(labels) =>
                      saveImmediateField(
                        "labels",
                        labels,
                        { labels: normalizeLabels(labels) },
                        "任务标签已更新"
                      )
                    }
                    options={labelOptions}
                    portalContainer={assigneeComboboxPortal}
                    value={form.labels}
                  />
                  {labelsError && (
                    <p className="text-xs text-destructive">{labelsError}</p>
                  )}
                </TaskField>

                <TaskField label="状态">
                  <Select
                    disabled={loading || saving}
                    onValueChange={(value) => {
                      const status = value as ProjectTaskStatus
                      saveImmediateField(
                        "status",
                        status,
                        { status },
                        "任务状态已更新"
                      )
                    }}
                    value={form.status}
                  >
                    <SelectTrigger aria-label="任务状态" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">
                        <Circle className="text-amber-600" />
                        待办
                      </SelectItem>
                      <SelectItem value="in_progress">
                        <CircleDot className="text-sky-600" />
                        进行中
                      </SelectItem>
                      <SelectItem value="done">
                        <CircleCheckBig className="text-emerald-600" />
                        已完成
                      </SelectItem>
                      <SelectItem value="canceled">
                        <CircleX className="text-stone-500" />
                        已取消
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TaskField>

                <TaskField label="创建人">
                  <DisabledUserInput user={details.creator} />
                </TaskField>

                <TaskField label="优先级">
                  <Select
                    disabled={loading || saving}
                    onValueChange={(value) => {
                      const priority = Number(value) as ProjectTaskPriority
                      saveImmediateField(
                        "priority",
                        priority,
                        { priority },
                        "任务优先级已更新"
                      )
                    }}
                    value={String(form.priority)}
                  >
                    <SelectTrigger aria-label="任务优先级" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">
                        <ChevronsUp className="text-rose-600" />高
                      </SelectItem>
                      <SelectItem value="2">
                        <Equal className="text-amber-600" />中
                      </SelectItem>
                      <SelectItem value="1">
                        <ChevronsDown className="text-muted-foreground" />低
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TaskField>
              </div>

              <div className="grid gap-4">
                <TaskField label="负责人">
                  <ProjectMemberCombobox
                    disabled={loading || saving || membersLoading}
                    loading={membersLoading}
                    members={memberOptions}
                    onValueChange={(member: ClientProjectMember | null) => {
                      const assigneeUserId = member?.id ?? ""
                      saveImmediateField(
                        "assigneeUserId",
                        assigneeUserId,
                        { assigneeUserId: assigneeUserId || null },
                        "任务负责人已更新"
                      )
                    }}
                    portalContainer={assigneeComboboxPortal}
                    showEmptyEmail={false}
                    value={selectedAssignee ?? null}
                  />
                  {membersError && (
                    <p className="text-xs text-destructive">{membersError}</p>
                  )}
                </TaskField>
              </div>

              <div className="grid gap-4">
                <TaskField label="开始日期">
                  <ProjectTaskDatePicker
                    disabled={loading || saving}
                    label="开始日期"
                    maximum={form.dueDate || undefined}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "startDate",
                        value,
                        { startDate: value || null },
                        "任务开始日期已更新"
                      )
                    }
                    value={form.startDate}
                  />
                </TaskField>
                <TaskField label="截止日期">
                  <ProjectTaskDatePicker
                    disabled={loading || saving}
                    label="截止日期"
                    minimum={form.startDate || undefined}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "dueDate",
                        value,
                        { dueDate: value || null },
                        "任务截止日期已更新"
                      )
                    }
                    value={form.dueDate}
                  />
                </TaskField>
                <TaskField label="提醒时间">
                  <ProjectTaskReminderField
                    disabled={loading || saving}
                    onValueChange={(value) =>
                      saveImmediateField(
                        "reminder",
                        value,
                        { reminder: value },
                        "任务提醒已更新"
                      )
                    }
                    state={
                      details.status === form.status &&
                      reminderInputsEqual(
                        form.reminder,
                        toReminderInput(details.reminder)
                      )
                        ? details.reminder?.state
                        : undefined
                    }
                    status={form.status}
                    value={form.reminder}
                  />
                </TaskField>
              </div>

              {(validationError || error) && (
                <p className="text-xs text-destructive">
                  {validationError || error}
                </p>
              )}
            </div>
          </div>
        </div>
        <div
          className="absolute top-0 left-0 size-0"
          ref={assigneeComboboxPortal}
        />
      </DialogContent>
      {embedded ? (
        <StandaloneEntityCardDialog
          card={card}
          onOpenChange={setSendDialogOpen}
          open={sendDialogOpen}
        />
      ) : (
        <SendCardDialog
          card={card}
          onOpenChange={setSendDialogOpen}
          open={sendDialogOpen}
        />
      )}
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!deleting) {
            setDeleteDialogOpen(nextOpen)
          }
        }}
        open={deleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              {`确定删除“${details.title}”吗？此操作无法撤销。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              variant="destructive"
            >
              {deleting && <Spinner />}
              删除任务
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

function TaskField({
  action,
  children,
  htmlFor,
  label,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  htmlFor?: string
  label: string
}) {
  return (
    <div className="grid content-start gap-2">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor}>{label}</Label>
          {action}
        </div>
      ) : (
        <Label htmlFor={htmlFor}>{label}</Label>
      )}
      {children}
    </div>
  )
}

function DisabledUserInput({ user }: { user: ProjectTask["creator"] }) {
  const displayName = user.nickname || user.name
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() ?? "?"

  return (
    <InputGroup>
      <InputGroupAddon align="inline-start">
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
      </InputGroupAddon>
      <InputGroupInput aria-label="创建人" disabled value={displayName} />
    </InputGroup>
  )
}

function createTaskEditForm(task: ProjectTask): TaskEditForm {
  return {
    assigneeUserId: task.assignee?.id ?? "",
    description: task.description,
    dueDate: task.dueDate ?? "",
    labels: [...task.labels],
    priority: task.priority,
    reminder: toReminderInput(task.reminder),
    startDate: task.startDate ?? "",
    status: task.status,
    title: task.title,
  }
}

function createFallbackProjectMember(
  task: ProjectTask
): ClientProjectMember | null {
  if (!task.assignee) {
    return null
  }
  return {
    avatar: task.assignee.avatar,
    displayName: task.assignee.nickname || task.assignee.name,
    email: "",
    id: task.assignee.id,
    name: task.assignee.name,
    nickname: task.assignee.nickname,
    role: "member",
    sourceGroupIds: [],
    status: "active",
  }
}

function normalizeTaskEditForm(form: TaskEditForm): NormalizedTaskEditForm {
  return {
    assigneeUserId: form.assigneeUserId || null,
    description: form.description,
    dueDate: form.dueDate || null,
    labels: normalizeLabels(form.labels),
    priority: form.priority,
    reminder: normalizeReminderInput(form.reminder),
    startDate: form.startDate || null,
    status: form.status,
    title: form.title.trim(),
  }
}

function normalizeLabels(values: string[]) {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const label = value.trim()
    const key = label.toLocaleLowerCase()
    if (label && !seen.has(key)) {
      seen.add(key)
      labels.push(label)
    }
  }
  return labels
}

function getTaskEditValidationError(form: NormalizedTaskEditForm) {
  const titleLength = Array.from(form.title).length
  if (titleLength < 1 || titleLength > 240) {
    return "标题长度必须为 1 到 240 个字符"
  }
  if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
    return "开始日期不能晚于截止日期"
  }
  if (form.labels.length > 20) {
    return "标签不能超过 20 个"
  }
  if (form.labels.some((label) => Array.from(label).length > 32)) {
    return "每个标签不能超过 32 个字符"
  }
  return ""
}

function mergeTaskEditFields<T extends TaskEditForm | NormalizedTaskEditForm>(
  current: T,
  source: T,
  fields: Array<keyof TaskEditForm>
): T {
  const values = Object.fromEntries(
    fields.map((field) => [field, source[field]])
  )
  return { ...current, ...values }
}

function taskEditFormsEqual(
  left: NormalizedTaskEditForm,
  right: NormalizedTaskEditForm
) {
  return (
    left.assigneeUserId === right.assigneeUserId &&
    left.description === right.description &&
    left.dueDate === right.dueDate &&
    left.priority === right.priority &&
    reminderInputsEqual(left.reminder, right.reminder) &&
    left.startDate === right.startDate &&
    left.status === right.status &&
    left.title === right.title &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index])
  )
}

function toReminderInput(
  reminder: ProjectTask["reminder"] | undefined
): ProjectTaskReminderInput | null {
  if (!reminder) {
    return null
  }
  if (reminder.mode === "once") {
    return {
      at: reminder.at,
      mode: "once",
      timezone: reminder.timezone,
    }
  }
  return normalizeReminderInput(reminder)
}

function normalizeReminderInput(
  reminder: ProjectTaskReminderInput | null
): ProjectTaskReminderInput | null {
  if (!reminder) {
    return null
  }
  if (reminder.mode === "once") {
    return { at: reminder.at, mode: "once", timezone: reminder.timezone }
  }
  if (reminder.frequency === "weekly") {
    return {
      frequency: "weekly",
      mode: "recurring",
      time: reminder.time,
      timezone: reminder.timezone,
      weekdays: [...(reminder.weekdays ?? [])].sort((a, b) => a - b),
    }
  }
  if (reminder.frequency === "monthly") {
    return {
      dayOfMonth: reminder.dayOfMonth,
      frequency: "monthly",
      mode: "recurring",
      time: reminder.time,
      timezone: reminder.timezone,
    }
  }
  return {
    frequency: "daily",
    mode: "recurring",
    time: reminder.time,
    timezone: reminder.timezone,
  }
}

function reminderInputsEqual(
  left: ProjectTaskReminderInput | null,
  right: ProjectTaskReminderInput | null
) {
  return (
    JSON.stringify(normalizeReminderInput(left)) ===
    JSON.stringify(normalizeReminderInput(right))
  )
}

function hydrateTaskDetailsUser(
  task: ProjectTask,
  usersById: ClientDataContextValue["usersById"]
) {
  const creator = usersById[task.creator.id]
  const assignee = task.assignee ? usersById[task.assignee.id] : undefined
  return {
    ...task,
    creator: creator
      ? {
          avatar: creator.avatar,
          id: creator.id,
          name: creator.name,
          nickname: creator.nickname,
        }
      : task.creator,
    assignee: assignee
      ? {
          avatar: assignee.avatar,
          id: assignee.id,
          name: assignee.name,
          nickname: assignee.nickname,
        }
      : task.assignee,
  }
}

async function listAllProjectTaskLabels(
  projectId: string,
  excludedTaskId: string
) {
  const labels = new Map<string, string>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectTasks(projectId, {
      cursor,
      limit: 100,
    })
    for (const projectTask of page.tasks) {
      if (projectTask.id === excludedTaskId) {
        continue
      }
      for (const label of projectTask.labels) {
        const key = label.toLocaleLowerCase()
        if (!labels.has(key)) {
          labels.set(key, label)
        }
      }
    }
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  return Array.from(labels.values()).sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  )
}
