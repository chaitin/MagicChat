import * as React from "react"
import { toast } from "sonner"

import { ProjectMemberCombobox } from "@/components/projects/project-member-combobox"
import type { ProjectTask } from "@/components/projects/project-types"
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
import { useOptionalClientData } from "@/lib/client-data-context"
import type { ClientProjectMember } from "@/lib/project-data-api"
import {
  hydrateClientProjectMembers,
  listAllClientProjectMembers,
} from "@/lib/project-members"

const emptyAssigneeUsersById = {}
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
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const usersById = clientData?.usersById ?? emptyAssigneeUsersById
  const [assigneeUserId, setAssigneeUserId] = React.useState(
    currentAssignee?.id ?? ""
  )
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [storedMembers, setMembers] = React.useState<ClientProjectMember[]>([])
  const members = React.useMemo(
    () => hydrateClientProjectMembers(storedMembers, usersById),
    [storedMembers, usersById]
  )
  const [saving, setSaving] = React.useState(false)
  const portal = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    void listAllClientProjectMembers(projectId)
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
  }, [ensureUsers, open, projectId])

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
          <ProjectMemberCombobox
            disabled={saving || loading}
            loading={loading}
            members={memberOptions}
            onValueChange={(member: ClientProjectMember | null) =>
              setAssigneeUserId(member?.id ?? "")
            }
            portalContainer={portal}
            value={selectedAssignee ?? null}
          />
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
