import type { ClientConversationMember } from "@/data/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import type { MentionSelection } from "@/features/conversation/mention-draft"

export type MentionCandidate = MentionSelection & {
  avatar: string
  description: string
}

export function createMentionCandidates(
  members: ClientConversationMember[]
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
    {
      avatar: "",
      description: "所有群成员",
      id: "all",
      label: "所有人",
      targetType: "all",
    },
    ...memberCandidates,
  ]
}
