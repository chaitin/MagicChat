import type {
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import {
  createPinyinSearchTokens,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"

export type DirectorySearchItem = ContactUser | ContactApp | ContactGroup

export type DirectorySearchEntry = {
  item: DirectorySearchItem
  originalIndex: number
  searchTokens: string[]
}

const searchResultLimit = 20

export function createDirectorySearchIndex({
  apps,
  groups,
  users,
}: {
  apps: ContactApp[]
  groups: ContactGroup[]
  users: ContactUser[]
}): DirectorySearchEntry[] {
  return [...users, ...apps, ...groups].map((item, originalIndex) => ({
    item,
    originalIndex,
    searchTokens: createDirectorySearchTokens(item),
  }))
}

export function searchDirectoryIndex(
  index: DirectorySearchEntry[],
  keyword: string
) {
  const query = normalizePinyinSearchQuery(keyword)
  if (!query) {
    return []
  }

  return index
    .map((entry) => ({
      entry,
      quality: getMatchQuality(entry.searchTokens, query),
    }))
    .filter(
      (result): result is typeof result & { quality: number } =>
        result.quality !== null
    )
    .sort(
      (left, right) =>
        left.quality - right.quality ||
        left.entry.originalIndex - right.entry.originalIndex
    )
    .slice(0, searchResultLimit)
    .map((result) => result.entry.item)
}

function createDirectorySearchTokens(item: DirectorySearchItem) {
  if (item.type === "user") {
    return createPinyinSearchTokens([
      item.nickname,
      item.name,
      item.email,
      item.phone,
    ])
  }
  if (item.type === "app") {
    return createPinyinSearchTokens([item.name, item.description])
  }
  return createPinyinSearchTokens([item.name])
}

function getMatchQuality(tokens: string[], query: string) {
  let bestQuality: number | null = null

  for (const token of tokens) {
    const quality = token === query ? 0 : token.startsWith(query) ? 1 : 2
    if (quality === 2 && !token.includes(query)) {
      continue
    }
    bestQuality =
      bestQuality === null ? quality : Math.min(bestQuality, quality)
  }

  return bestQuality
}
