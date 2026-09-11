import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function SelectionListAvatar({
  avatar,
  name,
}: {
  avatar?: string
  name: string
}) {
  const displayName = name.trim()

  return (
    <Avatar className="rounded-sm bg-muted after:rounded-sm" data-size="sm">
      {avatar && (
        <AvatarImage alt={displayName} className="rounded-sm" src={avatar} />
      )}
      <AvatarFallback className="rounded-sm">
        {Array.from(displayName)[0]?.toUpperCase() ?? "?"}
      </AvatarFallback>
    </Avatar>
  )
}
