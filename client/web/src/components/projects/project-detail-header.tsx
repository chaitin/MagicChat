import { ProjectAvatar } from "@/components/projects/project-avatar"
import { ProjectSettingsMenu } from "@/components/projects/project-settings-menu"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import type { ClientConversation, ClientUser } from "@/lib/client-data-api"
import type {
  ClientProjectDetail,
  ClientProjectMember,
} from "@/lib/project-data-api"

export function ProjectDetailHeader({
  groups,
  members,
  onProjectDeleted,
  onProjectUpdated,
  onRelationsChanged,
  project,
  user,
}: {
  groups: ClientConversation[]
  members: ClientProjectMember[]
  onProjectDeleted: () => Promise<void>
  onProjectUpdated: () => Promise<void>
  onRelationsChanged: () => Promise<void>
  project: ClientProjectDetail
  user: ClientUser
}) {
  const extraMemberCount = Math.max(project.memberCount - members.length, 0)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <ProjectAvatar className="size-8" project={project} user={user} />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{project.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {project.description.trim() || "暂无说明"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AvatarGroup className="hidden md:flex">
          {members.map((member) => {
            const initial =
              Array.from(member.displayName.trim())[0]?.toUpperCase() ?? "?"
            return (
              <Avatar className="size-6" key={member.id}>
                {member.avatar && (
                  <AvatarImage alt={member.displayName} src={member.avatar} />
                )}
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
            )
          })}
          {extraMemberCount > 0 && (
            <AvatarGroupCount className="size-6 text-[10px]">
              +{extraMemberCount}
            </AvatarGroupCount>
          )}
        </AvatarGroup>
        <ProjectSettingsMenu
          groups={groups}
          onProjectDeleted={onProjectDeleted}
          onProjectUpdated={onProjectUpdated}
          onRelationsChanged={onRelationsChanged}
          project={project}
          user={user}
        />
      </div>
    </header>
  )
}
