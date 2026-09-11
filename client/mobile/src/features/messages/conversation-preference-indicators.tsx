// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconBellOff from "@tabler/icons-react-native/IconBellOff"
import { XStack } from "tamagui"

import type { ClientConversation } from "@/core/models"
import { useXGUITheme } from "@/xgui"

export function ConversationPreferenceIndicators({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const { colors } = useXGUITheme()

  if (!conversation.notificationMuted) return null

  return (
    <XStack items="center" shrink={0}>
      <IconBellOff
        accessibilityLabel="消息免打扰"
        color={colors.textPlaceholder}
        size={14}
        strokeWidth={1.5}
      />
    </XStack>
  )
}
