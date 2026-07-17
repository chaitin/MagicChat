import { Bot } from "lucide-react-native"
import { Avatar, SizableText } from "tamagui"

import { GroupAvatar } from "@/components/avatar/group-avatar"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientConversation } from "@/data/models"
import type { ServerTarget } from "@/data/query"

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
    <Avatar rounded="$2" size="$3">
      <CachedAvatarImage avatar={conversation.avatar} server={server} />
      <Avatar.Fallback
        bg="$backgroundFocus"
        items="center"
        justify="center"
      >
        {conversation.type === "app" ? (
          <ThemedIcon icon={Bot} size={16} />
        ) : (
          <SizableText fontWeight="600" size="$2">
            {Array.from(conversation.name.trim())[0]?.toUpperCase() ?? "?"}
          </SizableText>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}
