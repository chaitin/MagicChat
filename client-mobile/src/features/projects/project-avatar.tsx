import { BriefcaseBusiness } from "lucide-react-native"
import { Avatar, Text } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import type { ClientProjectSummary, ClientUser } from "@/data/models"
import type { ServerTarget } from "@/data/query"
import { getContactDisplayName } from "@/domain/contacts/contact-display"

export function ProjectAvatar({
  currentUser,
  project,
  server,
}: {
  currentUser: ClientUser | null
  project: ClientProjectSummary
  server: ServerTarget
}) {
  const displayName = project.isPersonal
    ? currentUser
      ? getContactDisplayName(currentUser)
      : project.name
    : project.name
  const avatar = project.isPersonal ? currentUser?.avatar : project.avatar

  return (
    <Avatar rounded="$2" size="$4">
      <CachedAvatarImage avatar={avatar ?? ""} server={server} />
      <Avatar.Fallback bg="$backgroundPress" items="center" justify="center">
        {project.isPersonal ? (
          <Text fontWeight="600">{getInitial(displayName)}</Text>
        ) : (
          <ThemedIcon icon={BriefcaseBusiness} size={18} />
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
