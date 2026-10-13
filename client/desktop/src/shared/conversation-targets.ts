import type { AccountDataBridge, DesktopContactUser, DesktopConversation } from "./account-data.ts"
import { createUserSearchIndex, matchesUserSearch } from "./user-search.ts"

export type ConversationTargetCandidate =
  | { key: string; kind: "conversation"; conversation: DesktopConversation }
  | { key: string; kind: "contact"; contact: DesktopContactUser }

export function mergeConversationTargetCandidates(
  conversations: DesktopConversation[],
  contacts: DesktopContactUser[],
): ConversationTargetCandidate[] {
  const candidates: ConversationTargetCandidate[] = conversations
    .filter((conversation) => !conversation.topic?.archived && conversation.canSend !== false)
    .map((conversation) => ({
      key:
        conversation.type === "direct" && conversation.avatarType === "user"
          ? `contact:${conversation.avatarId.toLowerCase()}`
          : `conversation:${conversation.id}`,
      kind: "conversation",
      conversation,
    }))
  const existingUsers = new Set(
    conversations.flatMap((conversation) => {
      if (conversation.type !== "direct") return []
      const members = conversation.members?.map((member) => member.id) ?? []
      if (conversation.avatarType === "user") members.push(conversation.avatarId)
      return members.map((id) => id.toLowerCase())
    }),
  )
  for (const contact of contacts) {
    if (existingUsers.has(contact.id.toLowerCase())) continue
    existingUsers.add(contact.id.toLowerCase())
    candidates.push({ key: `contact:${contact.id.toLowerCase()}`, kind: "contact", contact })
  }
  return candidates
}

const searchIndexCache = new WeakMap<object, ReturnType<typeof createUserSearchIndex>>()

export function conversationTargetSearchIndex(candidate: ConversationTargetCandidate) {
  const cached = searchIndexCache.get(candidate)
  if (cached) return cached
  const index = createUserSearchIndex(
    candidate.kind === "contact"
      ? candidate.contact
      : {
          name: candidate.conversation.name,
          nickname: "",
          email: "",
          phone: "",
        },
  )
  searchIndexCache.set(candidate, index)
  return index
}

export function filterConversationTargets(
  candidates: ConversationTargetCandidate[],
  query: string,
) {
  return candidates.filter((candidate) =>
    matchesUserSearch(conversationTargetSearchIndex(candidate), query),
  )
}

export async function resolveConversationTarget(
  candidate: ConversationTargetCandidate,
  targetId: string,
  bridge: Pick<AccountDataBridge, "openContactConversation">,
  resolved: Map<string, string>,
): Promise<string> {
  if (candidate.kind === "conversation") return candidate.conversation.id
  const cached = resolved.get(candidate.key)
  if (cached) return cached
  const result = await bridge.openContactConversation({
    targetId,
    type: "user",
    id: candidate.contact.id,
  })
  if (!result.ok) throw new Error(result.error.message)
  if (result.data.canSend === false || result.data.topic?.archived)
    throw new Error("该对话暂时不能发送消息")
  resolved.set(candidate.key, result.data.id)
  return result.data.id
}

export function conversationTargetName(candidate: ConversationTargetCandidate): string {
  return candidate.kind === "conversation"
    ? candidate.conversation.name
    : candidate.contact.nickname || candidate.contact.name
}

export function conversationTargetAvatar(candidate: ConversationTargetCandidate) {
  return candidate.kind === "conversation"
    ? { type: candidate.conversation.avatarType, id: candidate.conversation.avatarId }
    : { type: candidate.contact.avatarType, id: candidate.contact.avatarId }
}
