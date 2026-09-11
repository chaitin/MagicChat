export type DocumentPresenceUser = {
  avatar: string
  color: string
  id: string
  name: string
}

const presenceColors = [
  "#0284c7",
  "#0d9488",
  "#7c3aed",
  "#ea580c",
  "#e11d48",
  "#4f46e5",
  "#16a34a",
  "#ca8a04",
]

export function documentPresenceColor(userId: string): string {
  let hash = 2166136261
  for (const character of userId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return presenceColors[(hash >>> 0) % presenceColors.length]
}

export function normalizeDocumentPresenceUsers(
  states: readonly unknown[],
  currentUserId: string
): DocumentPresenceUser[] {
  const users = new Map<string, DocumentPresenceUser>()
  for (const state of states) {
    if (!isRecord(state) || !isRecord(state.user)) continue
    const { avatar, color, id, name } = state.user
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof color !== "string"
    ) {
      continue
    }
    users.set(id, {
      avatar: typeof avatar === "string" ? avatar : "",
      color: safePresenceColor(color),
      id,
      name,
    })
  }
  return Array.from(users.values()).sort((left, right) => {
    if (left.id === currentUserId) return -1
    if (right.id === currentUserId) return 1
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

export function safePresenceColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : "#64748b"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
