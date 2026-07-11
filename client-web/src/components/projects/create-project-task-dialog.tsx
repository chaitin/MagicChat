import * as React from "react"
import { ChevronsDown, ChevronsUp, Equal } from "lucide-react"
import { toast } from "sonner"

import type { ProjectTaskPriority } from "@/components/projects/project-types"
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
import { InputGroupAddon } from "@/components/ui/input-group"
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
import { createClientProjectTask } from "@/lib/project-task-data-api"

export function CreateProjectTaskDialog({
  onCreated,
  onOpenChange,
  open,
  projectId,
}: {
  onCreated: () => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  projectId: string
}) {
  const [assigneeUserId, setAssigneeUserId] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [membersError, setMembersError] = React.useState("")
  const [membersLoading, setMembersLoading] = React.useState(true)
  const [priority, setPriority] = React.useState<ProjectTaskPriority>(2)
  const [saving, setSaving] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const assigneeComboboxAnchor = useComboboxAnchor()
  const assigneeComboboxPortal = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void listAllProjectMembers(projectId)
      .then((nextMembers) => {
        if (active) {
          setMembers(nextMembers.filter((member) => member.status === "active"))
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMembersError(
            error instanceof Error ? error.message : "加载项目成员失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setMembersLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [open, projectId])

  const selectedAssignee = members.find(
    (member) => member.id === assigneeUserId
  )
  const trimmedTitle = title.trim()
  const canSubmit = !saving && trimmedTitle.length > 0

  function resetForm() {
    setAssigneeUserId("")
    setDescription("")
    setMembers([])
    setMembersError("")
    setMembersLoading(true)
    setPriority(2)
    setSaving(false)
    setTitle("")
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setSaving(true)
    try {
      await createClientProjectTask(projectId, {
        assigneeUserId: assigneeUserId || null,
        description,
        priority,
        title: trimmedTitle,
      })
      await onCreated()
      resetForm()
      onOpenChange(false)
      toast.success("任务已创建")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建任务失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription className="sr-only">
            填写任务标题、描述、优先级和负责人。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="create-task-title">任务标题</Label>
            <Input
              autoFocus
              disabled={saving}
              id="create-task-title"
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="输入任务标题"
              value={title}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-task-description">任务描述</Label>
            <Textarea
              className="min-h-40"
              disabled={saving}
              id="create-task-description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="支持 Markdown"
              value={description}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TaskSelectField label="优先级">
              <Select
                disabled={saving}
                onValueChange={(value) =>
                  setPriority(Number(value) as ProjectTaskPriority)
                }
                value={String(priority)}
              >
                <SelectTrigger aria-label="任务优先级" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">
                    <ChevronsDown className="text-muted-foreground" />低
                  </SelectItem>
                  <SelectItem value="2">
                    <Equal className="text-amber-600" />中
                  </SelectItem>
                  <SelectItem value="3">
                    <ChevronsUp className="text-rose-600" />高
                  </SelectItem>
                </SelectContent>
              </Select>
            </TaskSelectField>

            <TaskSelectField label="负责人">
              <Combobox<ClientProjectMember>
                disabled={saving || membersLoading}
                filter={(member, query) => memberMatchesQuery(member, query)}
                isItemEqualToValue={(member, value) => member.id === value.id}
                itemToStringLabel={(member) => member.displayName}
                itemToStringValue={(member) => member.id}
                items={members}
                onValueChange={(member: ClientProjectMember | null) =>
                  setAssigneeUserId(member?.id ?? "")
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
                          <span className="block truncate text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {membersError && (
                <p className="text-xs text-destructive">{membersError}</p>
              )}
            </TaskSelectField>
          </div>

          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {saving && <Spinner />}
              创建
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

function TaskSelectField({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
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
