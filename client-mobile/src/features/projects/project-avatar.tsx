import { BriefcaseBusiness } from "lucide-react-native"
import { Avatar, Text } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientProjectSummary, ClientUser } from "@/data/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

export function ProjectAvatar({
  currentUser,
  project,
  serverUrl,
}: {
  currentUser: ClientUser | null
  project: ClientProjectSummary
  serverUrl: string
}) {
  const displayName = project.isPersonal
    ? currentUser
      ? getContactDisplayName(currentUser)
      : project.name
    : project.name
  const avatar = project.isPersonal ? currentUser?.avatar : project.avatar
  const avatarUrl = resolveServerAssetUrl(serverUrl, avatar ?? "")

  return (
    <Avatar rounded="$2" size="$4" theme={project.isPersonal ? "teal" : "yellow"}>
      {avatarUrl ? <Avatar.Image src={avatarUrl} /> : null}
      <Avatar.Fallback items="center" justify="center">
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
