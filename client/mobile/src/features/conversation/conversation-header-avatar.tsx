import { AppAvatar } from "@/components/avatar/app-avatar"
import { GroupAvatar } from "@/components/avatar/group-avatar"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"

export function ConversationHeaderAvatar({
  conversation,
  server,
}: {
  conversation: ClientConversation
  server: ServerTarget
}) {
  if (conversation.type === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        members={conversation.members}
        name={conversation.name}
        server={server}
        size="$3"
      />
    )
  }

  return (
    <AppAvatar accessibilityLabel={conversation.name} avatar={conversation.avatar} server={server} size="$3" type={conversation.type === "app" ? "app" : "user"} />
  )
}
