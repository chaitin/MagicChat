import { GroupAvatar } from "@/components/group-avatar"
import { SelectionListAvatar } from "@/components/selection-list-avatar"
import type { ClientConversation } from "@/lib/client-data-api"
import {
  getConversationAvatarName,
  getConversationAvatarType,
} from "@/lib/conversation-avatar-presentation"

export function ConversationSelectionAvatar({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const avatarName = getConversationAvatarName(conversation)

  if (getConversationAvatarType(conversation) === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        className="size-6"
        members={conversation.members}
        name={avatarName}
      />
    )
  }

  return <SelectionListAvatar avatar={conversation.avatar} name={avatarName} />
}
