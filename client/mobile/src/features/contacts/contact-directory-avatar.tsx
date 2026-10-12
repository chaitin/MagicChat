import { StyleSheet, View } from "react-native"

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
    <View style={styles.avatar}>
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
        <View
          style={[
            styles.onlineIndicator,
            {
              backgroundColor: online ? colors.brand5 : colors.textPlaceholder,
              borderColor: colors.background2,
            },
          ]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: { height: 44, width: 44 },
  onlineIndicator: {
    borderRadius: 5.5,
    borderWidth: 2,
    bottom: -2,
    height: 11,
    position: "absolute",
    right: -2,
    width: 11,
  },
})
