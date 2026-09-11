import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { ClientProjectMember } from "@/lib/project-data-api"
import { getAvatarInitial } from "@/lib/avatar"
import { cn } from "@/lib/utils"

export function ProjectMemberAvatar({
  className = "size-6",
  fallbackClassName,
  member,
}: {
  className?: string
  fallbackClassName?: string
  member: ClientProjectMember
}) {
  return (
    <Avatar className={cn(className, "shrink-0 rounded-sm after:rounded-sm")}>
      {member.avatar && (
        <AvatarImage
          alt={member.displayName}
          className="rounded-sm"
          src={member.avatar}
        />
      )}
      <AvatarFallback className={cn("rounded-sm", fallbackClassName)}>
        {getAvatarInitial(member.displayName)}
      </AvatarFallback>
    </Avatar>
  )
}
