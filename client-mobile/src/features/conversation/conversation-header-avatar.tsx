import { Bot } from "lucide-react-native"
import { Avatar, SizableText } from "tamagui"

import { GroupAvatar } from "@/components/avatar/group-avatar"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientConversation } from "@/data/models"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

export function ConversationHeaderAvatar({
  conversation,
  serverUrl,
}: {
  conversation: ClientConversation
  serverUrl: string
}) {
  if (conversation.type === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        members={conversation.members}
        name={conversation.name}
        serverUrl={serverUrl}
        size="$3"
      />
    )
  }

  const avatarUrl = resolveServerAssetUrl(serverUrl, conversation.avatar)

  return (
    <Avatar rounded="$2" size="$3">
      {avatarUrl ? <Avatar.Image src={avatarUrl} /> : null}
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
