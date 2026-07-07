import type { ClientConversationMember } from "@/lib/client-data-api"
import { cn } from "@/lib/utils"

type GroupAvatarMember = Pick<
  ClientConversationMember,
  "avatar" | "name" | "nickname" | "role"
>

type GroupAvatarProps = {
  className?: string
  members?: GroupAvatarMember[]
  name: string
}

const memberRoleOrder: Record<GroupAvatarMember["role"], number> = {
  owner: 0,
  admin: 1,
  member: 2,
}

export function GroupAvatar({
  className,
  members = [],
  name,
}: GroupAvatarProps) {
  const entries = buildGroupAvatarEntries(members, name)

  return (
    <div
      aria-label={name}
      className={cn(
        "relative size-8 shrink-0 overflow-hidden rounded-sm bg-muted p-0.5 select-none after:absolute after:inset-0 after:rounded-sm after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten",
        className
      )}
      role="img"
    >
      {entries.map((entry, index) => (
        <GroupAvatarTile
          key={`${entry.displayName}-${index}`}
          avatar={entry.avatar}
          displayName={entry.displayName}
          placement={getTilePlacement(index, entries.length)}
        />
      ))}
    </div>
  )
}

function GroupAvatarTile({
  avatar,
  displayName,
  placement,
}: {
  avatar: string
  displayName: string
  placement: string
}) {
  return (
    <div
      className={cn(
        "absolute flex size-1/2 items-center justify-center overflow-hidden bg-muted text-[10px] leading-none font-medium text-muted-foreground",
        placement
      )}
    >
      {avatar ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          src={avatar}
        />
      ) : (
        <span aria-hidden="true">{getInitial(displayName)}</span>
      )}
    </div>
  )
}

function buildGroupAvatarEntries(
  members: GroupAvatarMember[],
  groupName: string
) {
  const entries = members
    .map((member, index) => ({ index, member }))
    .sort((left, right) => {
      const roleDiff =
        memberRoleOrder[left.member.role] - memberRoleOrder[right.member.role]

      if (roleDiff !== 0) {
        return roleDiff
      }

      return left.index - right.index
    })
    .map(({ member }) => ({
      avatar: member.avatar,
      displayName: getMemberDisplayName(member),
    }))
    .slice(0, 4)

  if (entries.length === 0) {
    entries.push({
      avatar: "",
      displayName: groupName,
    })
  }

  return entries
}

function getTilePlacement(index: number, count: number) {
  if (count <= 1) {
    return "top-1/4 left-1/4"
  }

  if (count === 2) {
    return index === 0 ? "top-1/4 left-0" : "top-1/4 left-1/2"
  }

  if (count === 3) {
    if (index === 0) {
      return "top-0 left-1/4"
    }

    return index === 1 ? "top-1/2 left-0" : "top-1/2 left-1/2"
  }

  if (index === 0) {
    return "top-0 left-0"
  }
  if (index === 1) {
    return "top-0 left-1/2"
  }
  if (index === 2) {
    return "top-1/2 left-0"
  }

  return "top-1/2 left-1/2"
}

function getMemberDisplayName(
  member: Pick<GroupAvatarMember, "name" | "nickname">
) {
  return member.nickname.trim() || member.name.trim()
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
