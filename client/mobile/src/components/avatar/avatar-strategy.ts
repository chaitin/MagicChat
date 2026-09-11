export type AppAvatarType = "app" | "group" | "project" | "user"

export const AVATAR_FALLBACK_ICON_STROKE_WIDTH = 1.5
export const AVATAR_FALLBACK_ICON_SCALE = 26 / 44

export function getAvatarFallbackIconSize(size: number) {
  return Math.max(8, Math.min(32, size * AVATAR_FALLBACK_ICON_SCALE))
}

export function getGroupAvatarFallbackIconSize(size: number) {
  return size * AVATAR_FALLBACK_ICON_SCALE
}

export type AvatarMember = {
  avatar: string
  id?: string
  name: string
  nickname: string
  role: "owner" | "admin" | "member"
  type?: "app" | "user"
}

const roleOrder: Record<AvatarMember["role"], number> = {
  owner: 0,
  admin: 1,
  member: 2,
}

export function selectGroupAvatarMembers(members: AvatarMember[]) {
  const limit = members.length <= 4 ? 4 : 9
  return members
    .map((member, index) => ({ index, member }))
    .sort((a, b) => roleOrder[a.member.role] - roleOrder[b.member.role] || a.index - b.index)
    .slice(0, limit)
    .map(({ member }) => member)
}

export function getGroupAvatarGridSize(memberCount: number): 2 | 3 {
  return memberCount <= 4 ? 2 : 3
}

export function getAvatarFallbackColor(type: AppAvatarType) {
  return ({ app: "blue", group: "yellow", project: "orange", user: "indigo" } as const)[type]
}
