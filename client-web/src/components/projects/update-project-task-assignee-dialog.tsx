import * as React from "react"
import { toast } from "sonner"

import type { ProjectTask } from "@/components/projects/project-types"
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
import { InputGroupAddon } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import {
  type ClientProjectMember,
  listClientProjectMembers,
} from "@/lib/project-data-api"
import { updateClientProjectTask } from "@/lib/project-task-data-api"

export function UpdateProjectTaskAssigneeDialog({
  currentAssignee,
  onOpenChange,
  onUpdated,
  open,
  projectId,
  taskId,
}: {
  currentAssignee: ProjectTask["assignee"]
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
  open: boolean
  projectId: string
  taskId: string
}) {
  const [assigneeUserId, setAssigneeUserId] = React.useState(
    currentAssignee?.id ?? ""
  )
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [members, setMembers] = React.useState<ClientProjectMember[]>([])
  const [saving, setSaving] = React.useState(false)
  const anchor = useComboboxAnchor()
  const portal = React.useRef<HTMLDivElement | null>(null)

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
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "加载项目成员失败"
          )
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [open, projectId])

  const fallbackAssignee = createFallbackMember(currentAssignee)
  const memberOptions =
    fallbackAssignee &&
    !members.some((member) => member.id === fallbackAssignee.id)
      ? [fallbackAssignee, ...members]
      : members
  const selectedAssignee = memberOptions.find(
    (member) => member.id === assigneeUserId
  )
  const unchanged = assigneeUserId === (currentAssignee?.id ?? "")

  function handleOpenChange(nextOpen: boolean) {
    if (saving) {
      return
    }
    if (!nextOpen) {
      setAssigneeUserId(currentAssignee?.id ?? "")
      setError("")
      setLoading(true)
      setMembers([])
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || loading || unchanged) {
      return
    }

    setSaving(true)
    try {
      await updateClientProjectTask(projectId, taskId, {
        assigneeUserId: assigneeUserId || null,
      })
      await onUpdated()
      onOpenChange(false)
      toast.success("任务负责人已更新")
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "更新任务负责人失败"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改负责人</DialogTitle>
          <DialogDescription className="sr-only">
            选择任务的新负责人。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <Combobox<ClientProjectMember>
            disabled={saving || loading}
            filter={(member, query) => memberMatchesQuery(member, query)}
            isItemEqualToValue={(member, value) => member.id === value.id}
            itemToStringLabel={(member) => member.displayName}
            itemToStringValue={(member) => member.id}
            items={memberOptions}
            onValueChange={(member: ClientProjectMember | null) =>
              setAssigneeUserId(member?.id ?? "")
            }
            value={selectedAssignee ?? null}
          >
            <div ref={anchor}>
              <ComboboxInput
                aria-label="任务负责人"
                className="w-full"
                placeholder={loading ? "正在加载" : "未指派"}
                showClear
              >
                {selectedAssignee && (
                  <InputGroupAddon align="inline-start">
                    <MemberAvatar member={selectedAssignee} />
                  </InputGroupAddon>
                )}
              </ComboboxInput>
            </div>
            <ComboboxContent anchor={anchor} container={portal}>
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
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={saving || loading || unchanged} type="submit">
              {saving && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
        <div className="absolute top-0 left-0 size-0" ref={portal} />
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

function createFallbackMember(
  assignee: ProjectTask["assignee"]
): ClientProjectMember | null {
  if (!assignee) {
    return null
  }
  return {
    avatar: assignee.avatar,
    displayName: assignee.nickname || assignee.name,
    email: "",
    id: assignee.id,
    name: assignee.name,
    nickname: assignee.nickname,
    role: "member",
    sourceGroupIds: [],
    status: "active",
  }
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
