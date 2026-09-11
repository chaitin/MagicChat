// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle"

import type { EntityProfile } from "@/domain/entities/entity-profile"
import { XGUIList, XGUIListItem, useXGUITheme } from "@/xgui"

export function EntityDetailAction({
  currentUserId,
  isPending,
  onPress,
  profile,
}: {
  currentUserId: string | null
  isPending: boolean
  onPress: () => void
  profile: EntityProfile
}) {
  const { colors } = useXGUITheme()

  if (profile.type === "user" && profile.id === currentUserId) {
    return null
  }

  const joiningGroup = profile.type === "group" && !profile.joined
  const title = joiningGroup ? "加入群聊" : "发消息"

  return (
    <XGUIList>
      <XGUIListItem
        accessibilityLabel={title}
        centerContent
        disabled={isPending}
        leading={
          joiningGroup ? undefined : (
            <IconMessageCircle
              color={colors.link}
              size={26}
              strokeWidth={1}
            />
          )
        }
        link
        minHeight={60}
        onPress={onPress}
        title={title}
        titleFontSize={18}
      />
    </XGUIList>
  )
}
