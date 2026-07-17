import { Bot } from "lucide-react-native"
import { Avatar, SizableText } from "tamagui"

import { GroupAvatar } from "@/components/avatar/group-avatar"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ServerTarget } from "@/data/query"
import type { EntityProfile } from "@/domain/entities/entity-profile"

const PROFILE_AVATAR_SIZE = 88

export function EntityDetailAvatar({
  profile,
  server,
}: {
  profile: EntityProfile
  server: ServerTarget
}) {
  if (profile.type === "group") {
    return (
      <GroupAvatar
        avatar={profile.avatar}
        members={profile.avatarMembers}
        name={profile.displayName}
        server={server}
        size={PROFILE_AVATAR_SIZE}
      />
    )
  }

  return (
    <Avatar rounded="$3" size={PROFILE_AVATAR_SIZE}>
      <CachedAvatarImage avatar={profile.avatar} server={server} />
      <Avatar.Fallback
        bg="$backgroundFocus"
        items="center"
        justify="center"
      >
        {profile.type === "app" ? (
          <ThemedIcon icon={Bot} size={34} />
        ) : (
          <SizableText fontWeight="600" size="$7">
            {Array.from(profile.displayName.trim())[0]?.toUpperCase() ?? "?"}
          </SizableText>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}
