import type { SizeTokens } from "tamagui"
import { AppAvatar } from "@/components/avatar/app-avatar"
import type { AvatarMember } from "@/components/avatar/avatar-strategy"
import type { ServerTarget } from "@/core/server-target"

export type GroupAvatarMember = AvatarMember

export function GroupAvatar({ avatar, members = [], name, server, size = "$4" }: { avatar: string; members?: GroupAvatarMember[]; name: string; server: ServerTarget; size?: number | SizeTokens }) {
  return <AppAvatar accessibilityLabel={name} avatar={avatar} members={members} server={server} size={size} type="group" />
}
