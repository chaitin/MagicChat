import { Bot } from "lucide-react-native"
import { Avatar, SizableText } from "tamagui"

import { GroupAvatar } from "@/components/avatar/group-avatar"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { EntityProfile } from "@/domain/entities/entity-profile"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

const PROFILE_AVATAR_SIZE = 88

export function EntityDetailAvatar({
  profile,
  serverUrl,
}: {
  profile: EntityProfile
  serverUrl: string
}) {
  if (profile.type === "group") {
    return (
      <GroupAvatar
        avatar={profile.avatar}
        members={profile.avatarMembers}
        name={profile.displayName}
        serverUrl={serverUrl}
        size={PROFILE_AVATAR_SIZE}
      />
    )
  }

  const avatarUrl = resolveServerAssetUrl(serverUrl, profile.avatar)

  return (
    <Avatar rounded="$3" size={PROFILE_AVATAR_SIZE}>
      {avatarUrl ? <Avatar.Image src={avatarUrl} /> : null}
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
