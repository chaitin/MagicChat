// eslint-disable-next-line import/no-unresolved
import IconBriefcase from "@tabler/icons-react-native/IconBriefcase"
// eslint-disable-next-line import/no-unresolved
import IconRobotFace from "@tabler/icons-react-native/IconRobotFace"
// eslint-disable-next-line import/no-unresolved
import IconUser from "@tabler/icons-react-native/IconUser"
// eslint-disable-next-line import/no-unresolved
import IconUsers from "@tabler/icons-react-native/IconUsers"
import { useMemo, type ComponentType } from "react"
import { PixelRatio, View } from "react-native"
import { SvgXml } from "react-native-svg"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { buildGroupAvatarSvg } from "@/components/avatar/group-avatar-svg"
import {
  CompositeImage,
  GroupAvatarGenerator,
  useGroupAvatarComposite,
} from "@/components/avatar/group-avatar-composite"
import {
  AVATAR_FALLBACK_ICON_STROKE_WIDTH,
  getAvatarFallbackColor,
  getAvatarFallbackIconSize,
  getGroupAvatarTileRects,
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

const AVATAR_TOKEN_SIZES = { "$3": 36, "$4": 44, "$7": 74 } as const

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
  size?: number | keyof typeof AVATAR_TOKEN_SIZES
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
  const resolvedSize = typeof size === "number" ? size : AVATAR_TOKEN_SIZES[size]
  const radius = square
    ? 0
    : rounded
      ? resolvedSize / 2
      : Math.max(4, resolvedSize * 0.12)
  const entries = useMemo(
    () => type === "group" ? selectGroupAvatarMembers(members) : [],
    [members, type]
  )

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      style={{
        alignItems: "center",
        backgroundColor: colors.background1,
        borderRadius: radius,
        height: resolvedSize,
        justifyContent: "center",
        overflow: "hidden",
        width: resolvedSize,
      }}
    >
      {entries.length && type === "group" && !avatar ? (
        <CompositeGroupAvatar entries={entries} server={server} size={resolvedSize} theme={colorScheme} />
      ) : (
        <Fallback size={resolvedSize} type={type} />
      )}
      {avatar ? <CachedAvatarImage avatar={avatar} server={server} /> : null}
    </View>
  )
}

function CompositeGroupAvatar({ entries, server, size, theme }: { entries: AvatarMember[]; server: ServerTarget; size: number; theme: "light" | "dark" }) {
  const { colors } = useXGUITheme()
  const tokens = useMemo(
    () => ({ background1: colors.background1, fallbackBackground: colors.indigo, textOnColor: colors.textOnColor }),
    [colors.background1, colors.indigo, colors.textOnColor]
  )
  const composite = useGroupAvatarComposite({ entries, server, theme, tokens })
  const backgroundXml = useMemo(
    () => buildGroupAvatarSvg(entries.map((member) => ({ type: member.type === "app" ? "app" : "user" })), theme),
    [entries, theme]
  )
  const background = <SvgXml height={size} width={size} xml={backgroundXml} />
  return (
    <>
      {composite.generate && composite.generationSnapshot ? <GroupAvatarGenerator complete={composite.complete} entries={entries} fail={composite.fail} identity={composite.identity} key={composite.identity} server={server} size={size} snapshot={composite.generationSnapshot} theme={theme} tokens={tokens} /> : null}
      {composite.resource ? (
        <CompositeImage fallback={background} key={composite.resource.uri} onError={composite.invalidate} uri={composite.resource.uri} />
      ) : background}
      <MemberGrid entries={entries} server={server} size={size} />
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
  const tiles = getGroupAvatarTileRects(entries.length, size, PixelRatio.get())

  return (
    <View
      style={{
        height: size,
        left: 0,
        position: "absolute",
        top: 0,
        width: size,
        zIndex: 1,
      }}
    >
      {entries.map((member, index) => (
        <View key={`${member.name}-${index}`} style={{ ...tiles[index], overflow: "hidden", position: "absolute" }}>
          {member.avatar ? <CachedAvatarImage avatar={member.avatar} server={server} /> : null}
        </View>
      ))}
    </View>
  )
}
