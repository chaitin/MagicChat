import type { ClientConversationMember } from "@/core/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import type { MentionSelection } from "@/features/conversation/composer/mention-draft"

export type MentionCandidate = MentionSelection & {
  avatar: string
  description: string
}

export function createMentionCandidates(
  members: ClientConversationMember[],
  includeEveryone = true,
  assistantName = "茉莉"
): MentionCandidate[] {
  const memberCandidates = members.flatMap((member) => {
    const label =
      member.type === "app"
        ? member.name.trim()
        : getContactDisplayName(member)
    if (!label) return []

    return [
      {
        avatar: member.avatar,
        description:
          member.type === "app"
            ? "应用"
            : member.email || member.phone || "群成员",
        id: member.id,
        label,
        targetType: member.type,
      } satisfies MentionCandidate,
    ]
  })

  return [
    ...(includeEveryone
      ? [{ avatar: "", description: "所有群成员", id: "all", label: "所有人", targetType: "all" as const }]
      : []),
    ...memberCandidates,
    ...(!includeEveryone && !memberCandidates.some((candidate) => candidate.targetType === "app" && candidate.id === "00000000-0000-0000-0000-000000000001")
      ? [{
          avatar: "",
          description: "应用",
          id: "00000000-0000-0000-0000-000000000001",
          label: assistantName.trim() || "茉莉",
          targetType: "app" as const,
        }]
      : []),
  ]
}
