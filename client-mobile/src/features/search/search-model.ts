import type {
  ClientContacts,
  ClientConversation,
  ClientProjectSummary,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/data/models"
import {
  formatContactPhone,
  getContactDisplayName,
} from "@/domain/contacts/contact-display"

export type GlobalSearchResult =
  | {
      conversation: ClientConversation
      key: string
      type: "conversation"
    }
  | {
      contact: ContactApp | ContactGroup | ContactUser
      key: string
      type: "contact"
    }
  | {
      key: string
      project: ClientProjectSummary
      type: "project"
    }

export function buildGlobalSearchResults({
  contacts,
  conversations,
  currentUserId,
  keyword,
  personalProject,
  projects,
}: {
  contacts: ClientContacts
  conversations: ClientConversation[]
  currentUserId: string | null
  keyword: string
  personalProject: ClientProjectSummary | null
  projects: ClientProjectSummary[]
}): GlobalSearchResult[] {
  const normalizedKeyword = normalize(keyword)
  if (!normalizedKeyword) return []

  const conversationResults: GlobalSearchResult[] = conversations
    .filter((conversation) =>
      matches(
        getConversationSearchValues({
          contacts,
          conversation,
          currentUserId,
        }),
        normalizedKeyword
      )
    )
    .map((conversation) => ({
      conversation,
      key: `conversation:${conversation.id}`,
      type: "conversation",
    }))

  const contactResults: GlobalSearchResult[] = [
    ...contacts.users,
    ...contacts.groups,
    ...contacts.apps,
  ]
    .filter((contact) =>
      matches(getContactSearchValues(contact), normalizedKeyword)
    )
    .map((contact) => ({
      contact,
      key: `contact:${contact.type}:${contact.id}`,
      type: "contact",
    }))

  const projectsById = new Map<string, ClientProjectSummary>()
  if (personalProject) {
    projectsById.set(personalProject.id, personalProject)
  }
  for (const project of projects) {
    projectsById.set(project.id, project)
  }

  const projectResults: GlobalSearchResult[] = Array.from(
    projectsById.values()
  )
    .filter((project) =>
      matches([project.name, project.description], normalizedKeyword)
    )
    .map((project) => ({
      key: `project:${project.id}`,
      project,
      type: "project",
    }))

  return [...conversationResults, ...contactResults, ...projectResults]
}

function getConversationSearchValues({
  contacts,
  conversation,
  currentUserId,
}: {
  contacts: ClientContacts
  conversation: ClientConversation
  currentUserId: string | null
}) {
  if (conversation.type === "group") {
    return [conversation.name]
  }

  const values = [conversation.name]
  const members = (conversation.members ?? []).filter(
    (member) => member.id !== currentUserId
  )
  const memberIds = new Set(members.map((member) => member.id))

  for (const member of members) {
    values.push(
      member.name,
      member.nickname,
      member.email,
      member.phone,
      formatContactPhone(member.phone)
    )
  }

  if (conversation.type === "direct") {
    for (const user of contacts.users) {
      if (
        memberIds.has(user.id) ||
        (memberIds.size === 0 && hasConversationDisplayName(user, conversation))
      ) {
        values.push(...getContactSearchValues(user))
      }
    }
  }

  if (conversation.type === "app") {
    for (const app of contacts.apps) {
      if (
        app.id === conversation.id ||
        memberIds.has(app.id) ||
        normalize(app.name) === normalize(conversation.name)
      ) {
        values.push(...getContactSearchValues(app))
      }
    }
  }

  return values
}

function getContactSearchValues(
  contact: ContactApp | ContactGroup | ContactUser
) {
  if (contact.type === "user") {
    return [
      contact.name,
      contact.nickname,
      getContactDisplayName(contact),
      contact.email,
      contact.phone,
      formatContactPhone(contact.phone),
    ]
  }

  if (contact.type === "app") {
    return [contact.name, contact.description]
  }

  return [contact.name]
}

function hasConversationDisplayName(
  user: ContactUser,
  conversation: ClientConversation
) {
  const conversationName = normalize(conversation.name)
  return [user.name, user.nickname, getContactDisplayName(user)].some(
    (value) => normalize(value) === conversationName
  )
}

function matches(values: string[], keyword: string) {
  return values.some((value) => normalize(value).includes(keyword))
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase()
}
