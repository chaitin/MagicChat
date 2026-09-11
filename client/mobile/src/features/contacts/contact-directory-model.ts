import type {
  ClientContacts,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/core/models"
import {
  formatContactPhone,
  getContactDisplayName,
} from "@/domain/contacts/contact-display"

export type DirectoryTab = "user" | "app" | "group"

export type DirectoryCategory =
  | "all-apps"
  | "joined-groups"
  | "my-apps"
  | "new-friends"
  | "public-groups"

export const DIRECTORY_CATEGORY_TITLES: Record<DirectoryCategory, string> = {
  "all-apps": "所有应用",
  "joined-groups": "我加入的群组",
  "my-apps": "我的应用",
  "new-friends": "新朋友",
  "public-groups": "公开群组",
}

export const CONTACT_INDEX_LABELS = [
  ...Array.from({ length: 26 }, (_, index) =>
    String.fromCharCode("A".charCodeAt(0) + index)
  ),
  "#",
] as const

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
const latinNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
})
const PINYIN_INITIAL_BOUNDARIES = [
  ["A", "阿"],
  ["B", "八"],
  ["C", "嚓"],
  ["D", "咑"],
  ["E", "妸"],
  ["F", "发"],
  ["G", "噶"],
  ["H", "哈"],
  ["J", "击"],
  ["K", "咔"],
  ["L", "垃"],
  ["M", "妈"],
  ["N", "拿"],
  ["O", "哦"],
  ["P", "啪"],
  ["Q", "期"],
  ["R", "然"],
  ["S", "撒"],
  ["T", "塌"],
  ["W", "挖"],
  ["X", "昔"],
  ["Y", "压"],
  ["Z", "匝"],
] as const

type ContactSortValue = {
  bucket: number
  initial: string
  scriptOrder: number
  value: string
}

export function buildDirectorySections({
  activeTab,
  contacts,
  currentUserId,
  keyword,
}: {
  activeTab: DirectoryTab
  contacts: ClientContacts
  currentUserId: string
  keyword: string
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

  const users = contacts.users
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
    .map((contact) => {
      const displayName = getContactDisplayName(contact)
      return {
        contact,
        displayName,
        sortValue: getContactSortValue(displayName),
      }
    })
    .sort(comparePreparedContacts)

  const usersByIndexLabel = new Map<string, ContactUser[]>()
  for (const user of users) {
    const label = getContactIndexLabelFromSortValue(user.sortValue)
    const groupedUsers = usersByIndexLabel.get(label) ?? []
    groupedUsers.push(user.contact)
    usersByIndexLabel.set(label, groupedUsers)
  }

  return CONTACT_INDEX_LABELS.flatMap((label) => {
    const groupedUsers = usersByIndexLabel.get(label)
    return groupedUsers
      ? [
          {
            count: groupedUsers.length,
            data: groupedUsers.map((contact) => ({
              key: `user:${contact.id}`,
              type: "user" as const,
              value: contact,
            })),
            title: label,
          },
        ]
      : []
  })
}

export function getContactInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

export function isDirectoryCategory(value: string): value is DirectoryCategory {
  return value in DIRECTORY_CATEGORY_TITLES
}

export function buildDirectoryCategorySections({
  category,
  contacts,
  currentUserId,
}: {
  category: DirectoryCategory
  contacts: ClientContacts
  currentUserId: string
}): DirectorySection[] {
  if (category === "new-friends") return []

  if (category === "my-apps" || category === "all-apps") {
    const normalizedCurrentUserId = currentUserId.toLocaleLowerCase()
    const apps = [...contacts.apps]
      .filter(
        (app) =>
          category === "all-apps" ||
          app.creatorUserId?.toLocaleLowerCase() === normalizedCurrentUserId
      )
      .sort((left, right) => contactNameCollator.compare(left.name, right.name))

    return apps.length > 0
      ? [createAppSection(undefined, category, apps)]
      : []
  }

  const groups = [...contacts.groups]
    .filter((group) =>
      category === "joined-groups"
        ? group.joined
        : group.visibility === "public"
    )
    .sort((left, right) => contactNameCollator.compare(left.name, right.name))

  return groups.length > 0
    ? [createGroupSection(undefined, category, groups)]
    : []
}

function createAppSection(
  title: string | undefined,
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
  title: string | undefined,
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

function comparePreparedContacts(
  left: {
    contact: ContactUser
    displayName: string
    sortValue: ContactSortValue
  },
  right: {
    contact: ContactUser
    displayName: string
    sortValue: ContactSortValue
  }
) {
  return (
    left.sortValue.bucket - right.sortValue.bucket ||
    (left.sortValue.bucket === 0
      ? latinNameCollator.compare(
          left.sortValue.initial,
          right.sortValue.initial
        ) ||
        left.sortValue.scriptOrder - right.sortValue.scriptOrder ||
        contactNameCollator.compare(left.displayName, right.displayName)
      : contactNameCollator.compare(left.displayName, right.displayName)) ||
    contactNameCollator.compare(left.contact.email, right.contact.email) ||
    contactNameCollator.compare(left.contact.id, right.contact.id)
  )
}

export function getContactIndexLabel(name: string) {
  return getContactIndexLabelFromSortValue(getContactSortValue(name))
}

function getContactIndexLabelFromSortValue(sortValue: ContactSortValue) {
  if (sortValue.bucket !== 0) return "#"
  return /^[A-Z]$/.test(sortValue.initial) ? sortValue.initial : "#"
}

function getContactSortValue(name: string) {
  const trimmedName = name.trim()
  const firstCharacter = Array.from(trimmedName)[0] ?? ""
  const latinFirstCharacter = firstCharacter
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")

  if (/^[A-Z]$/i.test(latinFirstCharacter)) {
    return {
      bucket: 0,
      initial: latinFirstCharacter.toUpperCase(),
      scriptOrder: 0,
      value: trimmedName.normalize("NFD"),
    }
  }

  if (/^\p{Script=Han}$/u.test(firstCharacter)) {
    return {
      bucket: 0,
      initial: getHanPinyinInitial(firstCharacter),
      scriptOrder: 1,
      value: trimmedName,
    }
  }

  return { bucket: 1, initial: "#", scriptOrder: 2, value: trimmedName }
}

function getHanPinyinInitial(character: string) {
  let low = 0
  let high = PINYIN_INITIAL_BOUNDARIES.length - 1
  let matchedIndex = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const boundary = PINYIN_INITIAL_BOUNDARIES[middle]
    if (!boundary) break

    if (contactNameCollator.compare(character, boundary[1]) >= 0) {
      matchedIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return PINYIN_INITIAL_BOUNDARIES[matchedIndex]?.[0] ?? "A"
}
