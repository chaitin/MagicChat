import { UsersRound } from "lucide-react-native"
import { Avatar, Image, Text, YStack, type SizeTokens } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

export type GroupAvatarMember = {
  avatar: string
  name: string
  nickname: string
  role: "owner" | "admin" | "member"
}

type TilePlacement = {
  left: `${number}%`
  top: `${number}%`
}

const memberRoleOrder: Record<GroupAvatarMember["role"], number> = {
  owner: 0,
  admin: 1,
  member: 2,
}

export function GroupAvatar({
  avatar,
  members = [],
  name,
  serverUrl,
  size = "$4",
}: {
  avatar: string
  members?: GroupAvatarMember[]
  name: string
  serverUrl: string
  size?: number | SizeTokens
}) {
  const avatarUrl = resolveServerAssetUrl(serverUrl, avatar)
  const entries = buildGroupAvatarEntries(members, serverUrl)
  const numericSize = typeof size === "number" ? size : null
  const fallbackIconSize = numericSize ? Math.max(18, numericSize * 0.36) : 18
  const tileFontSize = numericSize ? Math.max(10, numericSize * 0.2) : 10

  return (
    <Avatar rounded="$2" size={size}>
      {avatarUrl ? <Avatar.Image src={avatarUrl} /> : null}
      <Avatar.Fallback
        accessibilityLabel={name}
        bg="$backgroundFocus"
        overflow="hidden"
        p={0}
      >
        {entries.length > 0 ? (
          <YStack height="100%" position="relative" width="100%">
            {entries.map((entry, index) => (
              <GroupAvatarTile
                key={`${entry.displayName}-${index}`}
                avatarUrl={entry.avatarUrl}
                displayName={entry.displayName}
                fontSize={tileFontSize}
                placement={getTilePlacement(index, entries.length)}
              />
            ))}
          </YStack>
        ) : (
          <YStack flex={1} items="center" justify="center">
            <ThemedIcon icon={UsersRound} size={fallbackIconSize} />
          </YStack>
        )}
      </Avatar.Fallback>
    </Avatar>
  )
}

function GroupAvatarTile({
  avatarUrl,
  displayName,
  fontSize,
  placement,
}: {
  avatarUrl: string
  displayName: string
  fontSize: number
  placement: TilePlacement
}) {
  return (
    <YStack
      bg="$backgroundPress"
      borderColor="$background"
      borderWidth={0.5}
      height="50%"
      items="center"
      justify="center"
      l={placement.left}
      overflow="hidden"
      position="absolute"
      t={placement.top}
      width="50%"
    >
      {avatarUrl ? (
        <Image height="100%" objectFit="cover" src={avatarUrl} width="100%" />
      ) : (
        <Text fontSize={fontSize} fontWeight="600" lineHeight={fontSize * 1.2}>
          {getInitial(displayName)}
        </Text>
      )}
    </YStack>
  )
}

function buildGroupAvatarEntries(
  members: GroupAvatarMember[],
  serverUrl: string
) {
  return members
    .map((member, index) => ({ index, member }))
    .sort((left, right) => {
      const roleDiff =
        memberRoleOrder[left.member.role] - memberRoleOrder[right.member.role]
      return roleDiff !== 0 ? roleDiff : left.index - right.index
    })
    .slice(0, 4)
    .map(({ member }) => ({
      avatarUrl: resolveServerAssetUrl(serverUrl, member.avatar),
      displayName: member.nickname.trim() || member.name.trim(),
    }))
}

function getTilePlacement(index: number, count: number): TilePlacement {
  if (count <= 1) return { left: "25%", top: "25%" }
  if (count === 2) {
    return { left: index === 0 ? "0%" : "50%", top: "25%" }
  }
  if (count === 3) {
    if (index === 0) return { left: "25%", top: "0%" }
    return { left: index === 1 ? "0%" : "50%", top: "50%" }
  }

  return {
    left: index % 2 === 0 ? "0%" : "50%",
    top: index < 2 ? "0%" : "50%",
  }
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
