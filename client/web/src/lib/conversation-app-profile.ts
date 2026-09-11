import type {
  ClientConversation,
  ContactApp,
} from "@/lib/client-data-api"

type ConversationAppProfile = Pick<ContactApp, "avatar" | "id" | "name">

export function getConversationAppProfile(
  conversation: ClientConversation | null | undefined,
  appId: string,
  appsById?: ReadonlyMap<string, ConversationAppProfile>
): ConversationAppProfile | null {
  const member = conversation?.members?.find(
    (currentMember) => currentMember.type === "app" && currentMember.id === appId
  )
  if (member) {
    return {
      avatar: member.avatar,
      id: member.id,
      name: member.name,
    }
  }

  return appsById?.get(appId) ?? null
}

export function getConversationAppDisplayName(
  conversation: ClientConversation | null | undefined,
  appId: string,
  appsById?: ReadonlyMap<string, ConversationAppProfile>
) {
  const appName = getConversationAppProfile(
    conversation,
    appId,
    appsById
  )?.name.trim()
  if (appName) {
    return appName
  }
  if (conversation?.type === "app" && conversation.name.trim()) {
    return conversation.name.trim()
  }

  return "应用"
}

export function getConversationAppAvatar(
  conversation: ClientConversation | null | undefined,
  appId: string,
  appsById?: ReadonlyMap<string, ConversationAppProfile>
) {
  const appAvatar = getConversationAppProfile(
    conversation,
    appId,
    appsById
  )?.avatar.trim()
  if (appAvatar) {
    return appAvatar
  }
  if (conversation?.type === "app") {
    return conversation.avatar
  }

  return ""
}
