import type {
  ClientContacts,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/data/models"
import {
  formatContactPhone,
  getContactDisplayName,
} from "@/domain/contacts/contact-display"

export type DirectoryTab = "user" | "app" | "group"

export type DirectoryItem =
  | { key: string; type: "user"; value: ContactUser }
  | { key: string; type: "app"; value: ContactApp }
  | { key: string; type: "group"; value: ContactGroup }

export type DirectorySection = {
  count: number
  data: DirectoryItem[]
  title?: string
}

const contactNameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
})

export function buildDirectorySections({
  activeTab,
  contacts,
  currentUserId,
  keyword,
  organizationName,
}: {
  activeTab: DirectoryTab
  contacts: ClientContacts
  currentUserId: string
  keyword: string
  organizationName: string
}): DirectorySection[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()

  if (activeTab === "app") {
    const apps = contacts.apps.filter((app) =>
      matchesKeyword([app.name, app.description], normalizedKeyword)
    )

    const normalizedCurrentUserId = currentUserId.toLocaleLowerCase()
    const builtInApps = apps.filter((app) => app.creatorUserId === null)
    const ownedApps = apps.filter(
      (app) =>
        app.creatorUserId?.toLocaleLowerCase() === normalizedCurrentUserId
    )
    const otherApps = apps.filter(
      (app) =>
        app.creatorUserId !== null &&
        app.creatorUserId.toLocaleLowerCase() !== normalizedCurrentUserId
    )

    return [
      createAppSection("内置应用", "built-in", builtInApps),
      createAppSection("我的应用", "owned", ownedApps),
      createAppSection("其他应用", "other", otherApps),
    ].filter((section) => section.data.length > 0)
  }

  if (activeTab === "group") {
    const groups = contacts.groups.filter((group) =>
      matchesKeyword([group.name], normalizedKeyword)
    )
    const joinedGroups = groups.filter((group) => group.joined)
    const publicGroups = groups.filter(
      (group) => group.visibility === "public"
    )

    return [
      createGroupSection("我加入的", "joined", joinedGroups),
      createGroupSection("公开群组", "public", publicGroups),
    ].filter((section) => section.data.length > 0)
  }

  const users = [...contacts.users]
    .filter((contact) =>
      matchesKeyword(
        [
          contact.email,
          contact.name,
          contact.nickname,
          contact.phone,
          formatContactPhone(contact.phone),
        ],
        normalizedKeyword
      )
    )
    .sort(compareContactsByDisplayName)

  return users.length > 0
    ? [
        {
          count: users.length,
          data: users.map((contact) => ({
            key: `user:${contact.id}`,
            type: "user",
            value: contact,
          })),
          title: organizationName,
        },
      ]
    : []
}

export function getContactInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function createAppSection(
  title: string,
  sectionKey: string,
  apps: ContactApp[]
): DirectorySection {
  return {
    count: apps.length,
    data: apps.map((app) => ({
      key: `app:${sectionKey}:${app.id}`,
      type: "app",
      value: app,
    })),
    title,
  }
}

function createGroupSection(
  title: string,
  sectionKey: string,
  groups: ContactGroup[]
): DirectorySection {
  return {
    count: groups.length,
    data: groups.map((group) => ({
      key: `group:${sectionKey}:${group.id}`,
      type: "group",
      value: group,
    })),
    title,
  }
}

function matchesKeyword(values: string[], keyword: string) {
  return (
    keyword.length === 0 ||
    values.some((value) => value.toLocaleLowerCase().includes(keyword))
  )
}

function compareContactsByDisplayName(left: ContactUser, right: ContactUser) {
  return (
    contactNameCollator.compare(
      getContactDisplayName(left),
      getContactDisplayName(right)
    ) ||
    contactNameCollator.compare(left.email, right.email) ||
    contactNameCollator.compare(left.id, right.id)
  )
}
