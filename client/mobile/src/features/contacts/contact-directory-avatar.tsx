import { Circle, YStack } from "tamagui"

import {
  GroupAvatar,
  type GroupAvatarMember,
} from "@/components/avatar/group-avatar"
import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ServerTarget } from "@/core/server-target"
import { useXGUITheme } from "@/xgui"

export function ContactDirectoryAvatar({
  avatar,
  members,
  name,
  online,
  server,
  type,
}: {
  avatar: string
  members?: GroupAvatarMember[]
  name: string
  online?: boolean
  server: ServerTarget
  type: "user" | "app" | "group"
}) {
  const { colors } = useXGUITheme()

  return (
    <YStack height="$4" width="$4">
      {type === "group" ? (
        <GroupAvatar
          avatar={avatar}
          members={members}
          name={name}
          server={server}
        />
      ) : (
        <AppAvatar accessibilityLabel={name} avatar={avatar} server={server} type={type} />
      )}

      {online !== undefined ? (
        <Circle
          bg={online ? "$green9" : "$gray8"}
          borderColor={colors.background2}
          borderWidth={2}
          b={-2}
          position="absolute"
          r={-2}
          size={11}
        />
      ) : null}
    </YStack>
  )
}
