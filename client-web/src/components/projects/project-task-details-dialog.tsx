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
import { toast } from "sonner"

import { ProjectTaskDatePicker } from "@/components/projects/project-task-date-picker"
import { ProjectTaskLabelsCombobox } from "@/components/projects/project-task-labels-combobox"
import type {
  ProjectTask,
  ProjectTaskPriority,
  ProjectTaskStatus,
} from "@/components/projects/project-types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  type ClientProjectMember,
  listClientProjectMembers,
} from "@/lib/project-data-api"
import {
  getClientProjectTask,
  listClientProjectTasks,
  type UpdateClientProjectTaskInput,
  updateClientProjectTask,
} from "@/lib/project-task-data-api"

type TaskEditForm = {
  assigneeUserId: string
  description: string
  dueDate: string
  labels: string[]
  priority: ProjectTaskPriority
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
  startDate: string | null
  status: ProjectTaskStatus
  title: string
}

export function ProjectTaskDetailsDialog({
  onOpenChange,
  onUpdated,
  open,
  task,
}: {
  onOpenChange: (open: boolean) => void
  onUpdated?: () => Promise<void>
  open: boolean
  task: ProjectTask
}) {
  const initialForm = createTaskEditForm(task)
  const [baseline, setBaseline] = React.useState<NormalizedTaskEditForm>(() =>
    normalizeTaskEditForm(initialForm)
  )
  const [details, setDetails] = React.useState(task)
  const [error, setError] = React.useState("")
  const [form, setForm] = React.useState<TaskEditForm>(initialForm)
  const [loading, setLoading] = React.useState(true)
  const [labelOptions, setLabelOptions] = React.useState<string[]>([])
  const [labelsError, setLabelsError] = React.useState("")
  const [labelsLoading, setLabelsLoading] = React.useState(true)
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [membersError, setMembersError] = React.useState("")
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const assigneeComboboxAnchor = useComboboxAnchor()
  const assigneeComboboxPortal = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void getClientProjectTask(task.projectId, task.id)
      .then((nextDetails) => {
        if (!active) {
          return
        }
        const loadedForm = createTaskEditForm(nextDetails)
        setBaseline(normalizeTaskEditForm(loadedForm))
        setDetails(nextDetails)
        setForm(loadedForm)
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

    void listAllProjectMembers(task.projectId)
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
  }, [open, task])

  const normalizedForm = normalizeTaskEditForm(form)
  const validationError = getTaskEditValidationError(normalizedForm)
  const dirty = !taskEditFormsEqual(normalizedForm, baseline)
  const canSave = dirty && !loading && !saving && !validationError
  const fallbackAssignee = createFallbackProjectMember(details)
  const memberOptions =
    fallbackAssignee &&
    !members.some((member) => member.id === fallbackAssignee.id)
      ? [fallbackAssignee, ...members]
      : members
  const selectedAssignee = memberOptions.find(
    (member) => member.id === form.assigneeUserId
  )

  function updateForm<K extends keyof TaskEditForm>(
    field: K,
    value: TaskEditForm[K]
  ) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      const resetForm = createTaskEditForm(details)
      setBaseline(normalizeTaskEditForm(resetForm))
      setError("")
      setForm(resetForm)
      setLoading(true)
      setLabelOptions([])
      setLabelsError("")
      setLabelsLoading(true)
      setMembers([])
      setMembersError("")
      setMembersLoading(true)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) {
      return
    }

    setSaving(true)
    try {
      const updatedTask = await updateClientProjectTask(
        task.projectId,
        task.id,
        createTaskEditPatch(normalizedForm, baseline)
      )
      const updatedForm = createTaskEditForm(updatedTask)
      setBaseline(normalizeTaskEditForm(updatedForm))
      setDetails(updatedTask)
      setError("")
      setForm(updatedForm)
      await onUpdated?.()
      toast.success("任务已保存")
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "保存任务失败"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-5xl"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            任务详情
            {loading && <Spinner />}
          </DialogTitle>
          <DialogDescription className="sr-only">
            查看并修改任务详情。
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1fr)] lg:items-start">
            <div className="grid min-w-0 content-start gap-5">
              <TaskField htmlFor="task-details-title" label="标题">
                <Input
                  autoFocus
                  disabled={loading || saving}
                  id="task-details-title"
                  maxLength={240}
                  onChange={(event) => updateForm("title", event.target.value)}
                  value={form.title}
                />
              </TaskField>

              <TaskField label="标签">
                <ProjectTaskLabelsCombobox
                  disabled={loading || saving}
                  loading={labelsLoading}
                  onValueChange={(labels) => updateForm("labels", labels)}
                  options={labelOptions}
                  portalContainer={assigneeComboboxPortal}
                  value={form.labels}
                />
                {labelsError && (
                  <p className="text-xs text-destructive">{labelsError}</p>
                )}
              </TaskField>

              <TaskField htmlFor="task-details-description" label="描述">
                <Textarea
                  className="min-h-52 lg:min-h-[26rem]"
                  disabled={loading || saving}
                  id="task-details-description"
                  onChange={(event) =>
                    updateForm("description", event.target.value)
                  }
                  placeholder="支持 Markdown"
                  value={form.description}
                />
              </TaskField>
            </div>

            <div className="grid min-w-0 content-start gap-5">
              <div className="grid gap-4">
                <TaskField label="状态">
                  <Select
                    disabled={loading || saving}
                    onValueChange={(value) =>
                      updateForm("status", value as ProjectTaskStatus)
                    }
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
                    onValueChange={(value) =>
                      updateForm(
                        "priority",
                        Number(value) as ProjectTaskPriority
                      )
                    }
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
                  <Combobox<ClientProjectMember>
                    disabled={loading || saving || membersLoading}
                    filter={(member, query) =>
                      memberMatchesQuery(member, query)
                    }
                    isItemEqualToValue={(member, value) =>
                      member.id === value.id
                    }
                    itemToStringLabel={(member) => member.displayName}
                    itemToStringValue={(member) => member.id}
                    items={memberOptions}
                    onValueChange={(member: ClientProjectMember | null) =>
                      updateForm("assigneeUserId", member?.id ?? "")
                    }
                    value={selectedAssignee ?? null}
                  >
                    <div ref={assigneeComboboxAnchor}>
                      <ComboboxInput
                        aria-label="任务负责人"
                        className="w-full"
                        placeholder={membersLoading ? "正在加载" : "未指派"}
                        showClear
                      >
                        {selectedAssignee && (
                          <InputGroupAddon align="inline-start">
                            <MemberAvatar member={selectedAssignee} />
                          </InputGroupAddon>
                        )}
                      </ComboboxInput>
                    </div>
                    <ComboboxContent
                      anchor={assigneeComboboxAnchor}
                      container={assigneeComboboxPortal}
                    >
                      <ComboboxEmpty>没有匹配的项目成员</ComboboxEmpty>
                      <ComboboxList>
                        {(member: ClientProjectMember) => (
                          <ComboboxItem key={member.id} value={member}>
                            <MemberAvatar className="size-8" member={member} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">
                                {member.displayName}
                              </span>
                              {member.email && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {member.email}
                                </span>
                              )}
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
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
                    onValueChange={(value) => updateForm("startDate", value)}
                    value={form.startDate}
                  />
                </TaskField>
                <TaskField label="截止日期">
                  <ProjectTaskDatePicker
                    disabled={loading || saving}
                    label="截止日期"
                    minimum={form.startDate || undefined}
                    onValueChange={(value) => updateForm("dueDate", value)}
                    value={form.dueDate}
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

          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              关闭
            </Button>
            <Button disabled={!canSave} type="submit">
              {saving && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
        <div
          className="absolute top-0 left-0 size-0"
          ref={assigneeComboboxPortal}
        />
      </DialogContent>
    </Dialog>
  )
}

function TaskField({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode
  htmlFor?: string
  label: string
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
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

function MemberAvatar({
  className = "size-6",
  member,
}: {
  className?: string
  member: ClientProjectMember
}) {
  const initial = Array.from(member.displayName.trim())[0]?.toUpperCase() ?? "?"

  return (
    <Avatar className={`${className} shrink-0 rounded-sm after:rounded-sm`}>
      {member.avatar && (
        <AvatarImage
          alt={member.displayName}
          className="rounded-sm"
          src={member.avatar}
        />
      )}
      <AvatarFallback className="rounded-sm">{initial}</AvatarFallback>
    </Avatar>
  )
}

function createTaskEditForm(task: ProjectTask): TaskEditForm {
  return {
    assigneeUserId: task.assignee?.id ?? "",
    description: task.description,
    dueDate: task.dueDate ?? "",
    labels: [...task.labels],
    priority: task.priority,
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

function taskEditFormsEqual(
  left: NormalizedTaskEditForm,
  right: NormalizedTaskEditForm
) {
  return (
    left.assigneeUserId === right.assigneeUserId &&
    left.description === right.description &&
    left.dueDate === right.dueDate &&
    left.priority === right.priority &&
    left.startDate === right.startDate &&
    left.status === right.status &&
    left.title === right.title &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index])
  )
}

function createTaskEditPatch(
  form: NormalizedTaskEditForm,
  baseline: NormalizedTaskEditForm
): UpdateClientProjectTaskInput {
  const patch: UpdateClientProjectTaskInput = {}
  if (form.assigneeUserId !== baseline.assigneeUserId) {
    patch.assigneeUserId = form.assigneeUserId
  }
  if (form.description !== baseline.description) {
    patch.description = form.description
  }
  if (form.dueDate !== baseline.dueDate) {
    patch.dueDate = form.dueDate
  }
  if (
    form.labels.length !== baseline.labels.length ||
    form.labels.some((label, index) => label !== baseline.labels[index])
  ) {
    patch.labels = form.labels
  }
  if (form.priority !== baseline.priority) {
    patch.priority = form.priority
  }
  if (form.startDate !== baseline.startDate) {
    patch.startDate = form.startDate
  }
  if (form.status !== baseline.status) {
    patch.status = form.status
  }
  if (form.title !== baseline.title) {
    patch.title = form.title
  }
  return patch
}

function memberMatchesQuery(member: ClientProjectMember, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [member.displayName, member.name, member.email].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  )
}

async function listAllProjectMembers(projectId: string) {
  const members: ClientProjectMember[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await listClientProjectMembers(projectId, {
      cursor,
      limit: 100,
    })
    members.push(...page.members)
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)

  return members
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
