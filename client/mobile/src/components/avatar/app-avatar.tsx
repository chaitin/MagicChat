// eslint-disable-next-line import/no-unresolved
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase"
// eslint-disable-next-line import/no-unresolved
import IconRobotFace from "@tabler/icons-react-native/IconRobotFace"
// eslint-disable-next-line import/no-unresolved
import IconUser from "@tabler/icons-react-native/IconUser"
// eslint-disable-next-line import/no-unresolved
import IconUsers from "@tabler/icons-react-native/IconUsers"
import type { ComponentType } from "react"
import { View } from "react-native"
import { Avatar, getTokenValue, type SizeTokens } from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import {
  CompositeImage,
  GroupAvatarGenerator,
  useGroupAvatarComposite,
} from "@/components/avatar/group-avatar-composite"
import {
  AVATAR_FALLBACK_ICON_STROKE_WIDTH,
  getAvatarFallbackColor,
  getAvatarFallbackIconSize,
  getGroupAvatarGridSize,
  selectGroupAvatarMembers,
  type AppAvatarType,
  type AvatarMember,
} from "@/components/avatar/avatar-strategy"
import type { ServerTarget } from "@/core/server-target"
import { useXGUITheme } from "@/xgui"

type AvatarIcon = ComponentType<{
  color?: string
  size?: number
  strokeWidth?: number
}>

const icons: Record<AppAvatarType, AvatarIcon> = {
  app: IconRobotFace,
  group: IconUsers,
  project: IconBriefcase,
  user: IconUser,
}

export type AppAvatarProps = {
  accessibilityLabel?: string
  avatar?: string | null
  members?: AvatarMember[]
  rounded?: boolean
  server: ServerTarget
  size?: number | SizeTokens
  square?: boolean
  type: AppAvatarType
}

export function AppAvatar({
  accessibilityLabel,
  avatar,
  members = [],
  rounded = false,
  server,
  size = "$4",
  square = false,
  type,
}: AppAvatarProps) {
  const { colorScheme, colors } = useXGUITheme()
  const resolvedSize =
    typeof size === "number"
      ? size
      : Number(
          getTokenValue(size as Parameters<typeof getTokenValue>[0], "size")
        ) || 40
  const radius = square
    ? 0
    : rounded
      ? resolvedSize / 2
      : Math.max(4, resolvedSize * 0.12)
  const entries = type === "group" ? selectGroupAvatarMembers(members) : []

  return (
    <Avatar
      accessibilityLabel={accessibilityLabel}
      backgroundColor={colors.background1}
      borderRadius={radius}
      overflow="hidden"
      size={size}
    >
      {entries.length && type === "group" && !avatar ? (
        <CompositeGroupAvatar entries={entries} server={server} size={resolvedSize} theme={colorScheme} />
      ) : (
        <Fallback size={resolvedSize} type={type} />
      )}
      {avatar ? <CachedAvatarImage avatar={avatar} server={server} /> : null}
    </Avatar>
  )
}

function CompositeGroupAvatar({ entries, server, size, theme }: { entries: AvatarMember[]; server: ServerTarget; size: number; theme: "light" | "dark" }) {
  const { colors } = useXGUITheme()
  const tokens = { background1: colors.background1, fallbackBackground: colors.indigo, textOnColor: colors.textOnColor }
  const composite = useGroupAvatarComposite({ entries, server, theme, tokens })
  return (
    <>
      {composite.generate && composite.generationSnapshot ? <GroupAvatarGenerator complete={composite.complete} entries={entries} fail={composite.fail} identity={composite.identity} key={composite.identity} server={server} size={size} snapshot={composite.generationSnapshot} tokens={tokens} /> : null}
      {composite.resource ? <CompositeImage onError={composite.invalidate} uri={composite.resource.uri} /> : <MemberGrid entries={entries} server={server} size={size} />}
    </>
  )
}

function Fallback({ size, type }: { size: number; type: AppAvatarType }) {
  const { colors } = useXGUITheme()
  const Icon = icons[type]
  const backgroundColor = colors[getAvatarFallbackColor(type)]

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <Icon
        color={colors.textOnColor}
        size={getAvatarFallbackIconSize(size)}
        strokeWidth={AVATAR_FALLBACK_ICON_STROKE_WIDTH}
      />
    </View>
  )
}

function MemberGrid({
  entries,
  server,
  size,
}: {
  entries: AvatarMember[]
  server: ServerTarget
  size: number
}) {
  const { colors } = useXGUITheme()
  const columns = getGroupAvatarGridSize(entries.length)
  const tileSize = size / columns
  const rows = Array.from(
    { length: Math.ceil(entries.length / columns) },
    (_, rowIndex) =>
      entries.slice(rowIndex * columns, (rowIndex + 1) * columns)
  )

  return (
    <View
      style={{
        backgroundColor: colors.background1,
        height: size,
        justifyContent: "center",
        left: 0,
        position: "absolute",
        top: 0,
        width: size,
        zIndex: 1,
      }}
    >
      {rows.map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={{
            alignSelf: "center",
            backgroundColor: colors.indigo,
            flexDirection: "row",
            height: tileSize,
            justifyContent: "center",
          }}
        >
          {row.map((member, columnIndex) => (
            <AppAvatar
              accessibilityLabel={member.nickname || member.name}
              avatar={null}
              key={`${member.name}-${rowIndex}-${columnIndex}`}
              rounded={false}
              server={server}
              size={tileSize}
              square
              type="user"
            />
          ))}
        </View>
      ))}
    </View>
  )
}
