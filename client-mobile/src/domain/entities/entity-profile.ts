import type {
  ClientContacts,
  ClientConversation,
  ClientConversationMember,
  ClientUser,
  ContactGroupAvatarMember,
} from "@/data/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"

export type EntityType = "user" | "app" | "group"

export type EntityReference = {
  id: string
  type: EntityType
}

export type UserEntityProfile = {
  avatar: string
  displayName: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  type: "user"
}

export type AppEntityProfile = {
  avatar: string
  description: string
  developerName: string | null
  displayName: string
  id: string
  online: boolean | null
  type: "app"
}

export type GroupEntityProfile = {
  avatar: string
  avatarMembers: ContactGroupAvatarMember[]
  displayName: string
  id: string
  joined: boolean
  memberCount: number
  type: "group"
  visibility: "private" | "public"
}

export type EntityProfile =
  | UserEntityProfile
  | AppEntityProfile
  | GroupEntityProfile

export function isEntityType(value: string): value is EntityType {
  return value === "user" || value === "app" || value === "group"
}

export function resolveEntityProfile({
  contacts,
  conversations,
  currentUser,
  reference,
}: {
  contacts: ClientContacts
  conversations: ClientConversation[]
  currentUser: ClientUser | null
  reference: EntityReference
}): EntityProfile | null {
  if (reference.type === "user") {
    return resolveUserProfile(reference.id, contacts, conversations, currentUser)
  }

  if (reference.type === "app") {
    return resolveAppProfile(
      reference.id,
      contacts,
      conversations,
      currentUser
    )
  }

  return resolveGroupProfile(reference.id, contacts, conversations)
}

export function getConversationEntityReference(
  conversation: ClientConversation,
  currentUserId: string
): EntityReference | null {
  if (conversation.type === "group") {
    return { id: conversation.id, type: "group" }
  }

  if (conversation.type === "app") {
    const appMember = conversation.members?.find(
      (member) => member.type === "app"
    )
    return { id: appMember?.id ?? conversation.id, type: "app" }
  }

  const otherUser = conversation.members?.find(
    (member) =>
      member.type === "user" && !idsMatch(member.id, currentUserId)
  )
  return otherUser ? { id: otherUser.id, type: "user" } : null
}

function resolveUserProfile(
  id: string,
  contacts: ClientContacts,
  conversations: ClientConversation[],
  currentUser: ClientUser | null
): UserEntityProfile | null {
  const user =
    (currentUser && idsMatch(currentUser.id, id) ? currentUser : null) ??
    contacts.users.find((item) => idsMatch(item.id, id)) ??
    findConversationMember(conversations, id, "user")

  if (!user) return null

  return {
    avatar: user.avatar,
    displayName: getContactDisplayName(user) || "未命名用户",
    email: user.email,
    id: user.id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    type: "user",
  }
}

function resolveAppProfile(
  id: string,
  contacts: ClientContacts,
  conversations: ClientConversation[],
  currentUser: ClientUser | null
): AppEntityProfile | null {
  const contact = contacts.apps.find((item) => idsMatch(item.id, id))

  if (contact) {
    const developer = contact.creatorUserId
      ? (currentUser && idsMatch(currentUser.id, contact.creatorUserId)
          ? currentUser
          : contacts.users.find((item) =>
              idsMatch(item.id, contact.creatorUserId ?? "")
            ))
      : null

    return {
      avatar: contact.avatar,
      description: contact.description,
      developerName: developer
        ? getContactDisplayName(developer) || developer.email
        : null,
      displayName: contact.name.trim() || "未命名应用",
      id: contact.id,
      online: contact.online,
      type: "app",
    }
  }

  const member = findConversationMember(conversations, id, "app")
  if (member) {
    return {
      avatar: member.avatar,
      description: "",
      developerName: null,
      displayName: member.name.trim() || member.nickname.trim() || "未命名应用",
      id: member.id,
      online: null,
      type: "app",
    }
  }

  const conversation = conversations.find(
    (item) => item.type === "app" && idsMatch(item.id, id)
  )
  if (!conversation) return null

  return {
    avatar: conversation.avatar,
    description: "",
    developerName: null,
    displayName: conversation.name.trim() || "未命名应用",
    id: conversation.id,
    online: null,
    type: "app",
  }
}

function resolveGroupProfile(
  id: string,
  contacts: ClientContacts,
  conversations: ClientConversation[]
): GroupEntityProfile | null {
  const contact = contacts.groups.find((item) => idsMatch(item.id, id))

  if (contact) {
    return {
      avatar: contact.avatar,
      avatarMembers: contact.avatarMembers,
      displayName: contact.name.trim() || "未命名群聊",
      id: contact.id,
      joined: contact.joined,
      memberCount: contact.memberCount,
      type: "group",
      visibility: contact.visibility,
    }
  }

  const conversation = conversations.find(
    (item) => item.type === "group" && idsMatch(item.id, id)
  )
  if (!conversation) return null

  return {
    avatar: conversation.avatar,
    avatarMembers: conversation.members ?? [],
    displayName: conversation.name.trim() || "未命名群聊",
    id: conversation.id,
    joined: true,
    memberCount: conversation.memberCount || conversation.members?.length || 0,
    type: "group",
    visibility: conversation.visibility,
  }
}

function findConversationMember(
  conversations: ClientConversation[],
  id: string,
  type: "user" | "app"
): ClientConversationMember | undefined {
  for (const conversation of conversations) {
    const member = conversation.members?.find(
      (item) => item.type === type && idsMatch(item.id, id)
    )
    if (member) {
      return member
    }
  }

  return undefined
}

function idsMatch(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}
