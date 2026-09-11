import { Pressable } from "react-native"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { GroupAvatar } from "@/components/avatar/group-avatar"
import type { ServerTarget } from "@/core/server-target"
import type { EntityProfile } from "@/domain/entities/entity-profile"

const PROFILE_AVATAR_SIZE = 72

export function EntityDetailAvatar({
  onPress,
  profile,
  server,
}: {
  onPress?: () => void
  profile: EntityProfile
  server: ServerTarget
}) {
  const avatar =
    profile.type === "group" ? (
      <GroupAvatar
        avatar={profile.avatar}
        members={profile.avatarMembers}
        name={profile.displayName}
        server={server}
        size={PROFILE_AVATAR_SIZE}
      />
    ) : (
      <AppAvatar accessibilityLabel={profile.displayName} avatar={profile.avatar} server={server} size={PROFILE_AVATAR_SIZE} type={profile.type} />
    )

  if (!onPress) return avatar

  return (
    <Pressable
      accessibilityLabel={`预览${profile.displayName}的头像`}
      accessibilityRole="button"
      onPress={onPress}
    >
      {avatar}
    </Pressable>
  )
}
