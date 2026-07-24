import { BellOff, Pin } from "lucide-react-native"
import { useTheme, XStack } from "tamagui"

import type { ClientConversation } from "@/data/models"

export function ConversationPreferenceIndicators({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const theme = useTheme()
  const color = String(theme.gray10.val)

  if (!conversation.pinned && !conversation.notificationMuted) {
    return null
  }

  return (
    <XStack gap={2} items="center" shrink={0}>
      {conversation.pinned ? (
        <Pin accessibilityLabel="已置顶" color={color} size={11} strokeWidth={1.7} />
      ) : null}
      {conversation.notificationMuted ? (
        <BellOff
          accessibilityLabel="消息免打扰"
          color={color}
          size={11}
          strokeWidth={1.7}
        />
      ) : null}
    </XStack>
  )
}
