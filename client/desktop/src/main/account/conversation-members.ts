import type { DesktopConversationMember } from "../../shared/account-data.ts"

export function parseConversationMembers(value: unknown): DesktopConversationMember[] {
  if (!isRecord(value) || !Array.isArray(value.members)) return []
  return value.members.flatMap((member): DesktopConversationMember[] => {
    if (!isRecord(member) || (member.type !== "user" && member.type !== "app")) return []
    if (typeof member.id !== "string" || !member.id || member.id.length > 128) return []
    return [
      {
        id: member.id,
        type: member.type,
        name: text(member.name),
        nickname: text(member.nickname),
        email: text(member.email),
        phone: text(member.phone),
      },
    ]
  })
}

function text(value: unknown) {
  return typeof value === "string" ? value.slice(0, 256) : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
