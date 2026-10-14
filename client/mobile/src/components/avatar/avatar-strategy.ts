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

export function getGroupAvatarTileRects(memberCount: number, size: number, pixelRatio: number) {
  const columns = getGroupAvatarGridSize(memberCount)
  const rows = Math.ceil(memberCount / columns)
  const verticalOffset = (columns - rows) / (2 * columns)
  // Share rounded boundaries instead of accumulating separately rounded row heights.
  const edge = (fraction: number) => fraction === 1 ? size : Math.round(fraction * size * pixelRatio) / pixelRatio
  return Array.from({ length: memberCount }, (_, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const columnsInRow = Math.min(columns, memberCount - row * columns)
    const horizontalOffset = (columns - columnsInRow) / (2 * columns)
    const left = edge(horizontalOffset + column / columns)
    const right = edge(horizontalOffset + (column + 1) / columns)
    const top = edge(verticalOffset + row / columns)
    const bottom = edge(verticalOffset + (row + 1) / columns)
    return { left, top, width: right - left, height: bottom - top }
  })
}

export function getAvatarFallbackColor(type: AppAvatarType) {
  return ({ app: "blue", group: "yellow", project: "orange", user: "indigo" } as const)[type]
}
