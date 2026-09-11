import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ClientProjectSummary, ClientUser } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"

export function ProjectAvatar({
  currentUser,
  project,
  server,
}: {
  currentUser: ClientUser | null
  project: ClientProjectSummary
  server: ServerTarget
}) {
  const avatar = project.isPersonal ? currentUser?.avatar : project.avatar
  return <AppAvatar accessibilityLabel={project.name} avatar={avatar} server={server} type="project" />
}
