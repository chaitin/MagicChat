import * as React from "react"
import { Loader2 } from "lucide-react"

import { ProjectMemberAvatar } from "@/components/projects/project-member-avatar"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useClientData } from "@/lib/client-data-context"
import type { ClientProjectMember } from "@/lib/project-data-api"
import {
  hydrateClientProjectMembers,
  listAllClientProjectMembers,
} from "@/lib/project-members"

export function ProjectMembersTab({ projectId }: { projectId: string }) {
  const { ensureUsers, usersById } = useClientData()
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [storedMembers, setMembers] = React.useState<ClientProjectMember[]>([])
  const members = React.useMemo(
    () => hydrateClientProjectMembers(storedMembers, usersById),
    [storedMembers, usersById]
  )

  React.useEffect(() => {
    let active = true

    void listAllClientProjectMembers(projectId)
      .then(async (nextMembers) => {
        await ensureUsers(nextMembers.map((member) => member.id))
        if (active) setMembers(nextMembers)
      })
      .catch((loadError) => {
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
  }, [ensureUsers, projectId])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-muted/10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载成员
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/10 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/10 text-sm text-muted-foreground">
        暂无项目成员
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1 bg-muted/10">
      <div className="grid w-full gap-2 p-4">
        {members.map((member) => {
          return (
            <Item
              className="cursor-default px-3 py-2.5 hover:bg-muted"
              key={member.id}
              size="sm"
              variant="outline"
            >
              <ItemMedia>
                <ProjectMemberAvatar
                  className="size-9 bg-muted"
                  member={member}
                />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="truncate">{member.displayName}</ItemTitle>
                <ItemDescription className="truncate text-xs">
                  {member.email}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">
                  {member.role === "owner" ? "所有者" : "成员"}
                </Badge>
              </ItemActions>
            </Item>
          )
        })}
      </div>
    </ScrollArea>
  )
}
