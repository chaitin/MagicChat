import { createHash } from "node:crypto"
import type { AvatarCacheRecord, AvatarMemberDescriptor } from "./avatar-types"

const compositeSize = 256
const roleOrder = { owner: 0, admin: 1, member: 2 } as const

export const compositeStyleVersion = 2

export function selectGroupMembers(members: AvatarMemberDescriptor[]): AvatarMemberDescriptor[] {
  const limit = members.length <= 4 ? 4 : 9
  return members
    .map((member, index) => ({ member, index }))
    .sort(
      (left, right) =>
        roleOrder[left.member.role] - roleOrder[right.member.role] || left.index - right.index,
    )
    .slice(0, limit)
    .map(({ member }) => member)
}

export async function buildCompositeAvatar(
  tiles: Array<{ member: AvatarMemberDescriptor; record?: AvatarCacheRecord }>,
  grid: 2 | 3,
  theme: "light" | "dark",
  load: (file: string) => Promise<Uint8Array>,
) {
  const tileSize = compositeSize / grid
  const rows = Math.ceil(tiles.length / grid)
  const verticalOffset = (compositeSize - rows * tileSize) / 2
  const parts = await Promise.all(
    tiles.map(async ({ member, record }, index) => {
      const row = Math.floor(index / grid)
      const columnsInRow = Math.min(grid, tiles.length - row * grid)
      const column = index % grid
      const x = (compositeSize - columnsInRow * tileSize) / 2 + column * tileSize
      const y = verticalOffset + row * tileSize
      if (record) {
        try {
          const bytes = await load(record.localFile)
          const source = `data:${record.contentType};base64,${Buffer.from(bytes).toString("base64")}`
          return `<image href="${source}" x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" preserveAspectRatio="xMidYMid slice"/>`
        } catch {
          // 单个成员缓存损坏时使用该成员类型的 Fallback。
        }
      }
      return fallbackTile(member.type, x, y, tileSize, theme)
    }),
  )
  const background = theme === "dark" ? "#1e1e1e" : "#f7f7f7"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${compositeSize}" height="${compositeSize}" viewBox="0 0 ${compositeSize} ${compositeSize}"><rect width="100%" height="100%" fill="${background}"/>${parts.join("")}</svg>`
}

export function compositeSignature(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function fallbackTile(
  type: "user" | "app",
  x: number,
  y: number,
  size: number,
  theme: "light" | "dark",
) {
  const color = type === "app" ? "#10aeff" : theme === "dark" ? "#1196ff" : "#1485ee"
  const centerX = x + size / 2
  const centerY = y + size / 2
  const radius = size * 0.16
  if (type === "app") {
    return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><rect x="${centerX - radius * 1.7}" y="${centerY - radius * 1.25}" width="${radius * 3.4}" height="${radius * 2.6}" rx="${radius * 0.6}" fill="none" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX - radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><circle cx="${centerX + radius * 0.65}" cy="${centerY}" r="${radius * 0.2}" fill="#fff"/><path d="M ${centerX} ${centerY - radius * 1.25}V ${centerY - radius * 2}" stroke="#fff" stroke-width="${Math.max(2, size * 0.05)}"/><circle cx="${centerX}" cy="${centerY - radius * 2.1}" r="${radius * 0.2}" fill="#fff"/></g>`
  }
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/><circle cx="${centerX}" cy="${centerY - radius}" r="${radius}" fill="#fff"/><ellipse cx="${centerX}" cy="${centerY + radius * 1.4}" rx="${radius * 1.7}" ry="${radius * 1.3}" fill="#fff"/></g>`
}
