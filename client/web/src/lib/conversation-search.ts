import type {
  ClientConversation,
  ClientConversationMember,
} from "@/lib/client-data-api"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import {
  createPinyinSearchTokens,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"

export type ConversationSearchFieldKind =
  | "conversation_name"
  | "member_name"
  | "member_nickname"
  | "member_email"
  | "member_phone"
  | "app_name"

export type ConversationSearchField = {
  kind: ConversationSearchFieldKind
  memberId?: string
  memberDisplayName?: string
  rawValue: string
  searchTokens: string[]
}

export type ConversationSearchEntry = {
  conversation: ClientConversation
  currentUserId: string
  fields: ConversationSearchField[]
  originalIndex: number
  recentActivityAt: number
}

export type ConversationSearchMatchQuality = "exact" | "prefix" | "contains"

export type ConversationSearchResult = {
  conversation: ClientConversation
  matchedField: ConversationSearchField | null
  matchQuality: ConversationSearchMatchQuality | null
}

const searchResultLimit = 20

export function createConversationSearchIndex(
  conversations: ClientConversation[],
  currentUserId: string,
  previousIndex: ConversationSearchEntry[] = []
): ConversationSearchEntry[] {
  const previousEntriesById = new Map(
    previousIndex.map((entry) => [entry.conversation.id, entry])
  )

  return conversations.map((conversation, originalIndex) => {
    const previousEntry = previousEntriesById.get(conversation.id)
    const fields = canReuseSearchFields(
      previousEntry,
      conversation,
      currentUserId
    )
      ? previousEntry.fields
      : createConversationSearchFields(conversation, currentUserId)

    return {
      conversation,
      currentUserId,
      fields,
      originalIndex,
      recentActivityAt: getRecentActivityAt(conversation),
    }
  })
}

export function searchConversationIndex(
  index: ConversationSearchEntry[],
  keyword: string
): ConversationSearchResult[] {
  const query = normalizePinyinSearchQuery(keyword)

  if (!query) {
    return []
  }

  return index
    .map((entry) => findBestConversationMatch(entry, query))
    .filter((result): result is RankedConversationSearchResult =>
      Boolean(result)
    )
    .sort(compareRankedSearchResults)
    .slice(0, searchResultLimit)
    .map(({ conversation, matchedField, matchQuality }) => ({
      conversation,
      matchedField,
      matchQuality,
    }))
}

function canReuseSearchFields(
  previousEntry: ConversationSearchEntry | undefined,
  conversation: ClientConversation,
  currentUserId: string
): previousEntry is ConversationSearchEntry {
  return Boolean(
    previousEntry &&
    previousEntry.currentUserId === currentUserId &&
    previousEntry.conversation.name === conversation.name &&
    previousEntry.conversation.type === conversation.type &&
    previousEntry.conversation.topic?.parentConversationName ===
      conversation.topic?.parentConversationName &&
    previousEntry.conversation.members === conversation.members
  )
}

function createConversationSearchFields(
  conversation: ClientConversation,
  currentUserId: string
) {
  const fields: ConversationSearchField[] = []

  addField(
    fields,
    "conversation_name",
    getConversationDisplayName(conversation)
  )

  if (conversation.type === "app") {
    return fields
  }

  for (const member of conversation.members ?? []) {
    if (member.type === "user" && member.id === currentUserId) {
      continue
    }

    if (conversation.type === "direct") {
      if (member.type === "user") {
        addUserMemberFields(fields, member)
      }
      continue
    }

    if (member.type === "app") {
      addAppMemberFields(fields, member)
    } else {
      addUserMemberFields(fields, member)
    }
  }

  return fields
}

function addUserMemberFields(
  fields: ConversationSearchField[],
  member: ClientConversationMember
) {
  addMemberField(fields, "member_name", member, member.name)
  addMemberField(fields, "member_nickname", member, member.nickname)
  addMemberField(fields, "member_email", member, member.email)
  addMemberField(fields, "member_phone", member, member.phone)
}

function addAppMemberFields(
  fields: ConversationSearchField[],
  member: ClientConversationMember
) {
  addMemberField(fields, "app_name", member, member.name)
  addMemberField(fields, "app_name", member, member.nickname)
}

function addMemberField(
  fields: ConversationSearchField[],
  kind: ConversationSearchFieldKind,
  member: ClientConversationMember,
  rawValue: string
) {
  addField(fields, kind, rawValue, {
    memberDisplayName:
      member.nickname || member.name || member.email || member.phone,
    memberId: member.id,
  })
}

function addField(
  fields: ConversationSearchField[],
  kind: ConversationSearchFieldKind,
  rawValue: string,
  member?: Pick<ConversationSearchField, "memberDisplayName" | "memberId">
) {
  const value = rawValue.trim()
  if (!value) {
    return
  }

  fields.push({
    kind,
    ...member,
    rawValue: value,
    searchTokens: createPinyinSearchTokens([value]),
  })
}

type RankedConversationSearchResult = {
  conversation: ClientConversation
  fieldPriority: number
  matchedField: ConversationSearchField
  matchQuality: ConversationSearchMatchQuality
  originalIndex: number
  recentActivityAt: number
}

function findBestConversationMatch(
  entry: ConversationSearchEntry,
  query: string
): RankedConversationSearchResult | null {
  let bestMatch:
    | {
        field: ConversationSearchField
        fieldPriority: number
        quality: ConversationSearchMatchQuality
      }
    | undefined

  for (const field of entry.fields) {
    const quality = getFieldMatchQuality(field, query)
    if (!quality) {
      continue
    }

    const candidate = {
      field,
      fieldPriority: getFieldPriority(entry.conversation, field),
      quality,
    }

    if (!bestMatch || compareFieldMatches(candidate, bestMatch) < 0) {
      bestMatch = candidate
    }
  }

  if (!bestMatch) {
    return null
  }

  return {
    conversation: entry.conversation,
    fieldPriority: bestMatch.fieldPriority,
    matchedField: bestMatch.field,
    matchQuality: bestMatch.quality,
    originalIndex: entry.originalIndex,
    recentActivityAt: entry.recentActivityAt,
  }
}

function getFieldMatchQuality(
  field: ConversationSearchField,
  query: string
): ConversationSearchMatchQuality | null {
  let bestQuality: ConversationSearchMatchQuality | null = null

  for (const token of field.searchTokens) {
    const normalizedToken = normalizePinyinSearchQuery(token)
    if (!normalizedToken.includes(query)) {
      continue
    }

    const quality =
      normalizedToken === query
        ? "exact"
        : normalizedToken.startsWith(query)
          ? "prefix"
          : "contains"

    if (
      !bestQuality ||
      matchQualityPriority[quality] < matchQualityPriority[bestQuality]
    ) {
      bestQuality = quality
    }
  }

  return bestQuality
}

function getFieldPriority(
  conversation: ClientConversation,
  field: ConversationSearchField
) {
  if (field.kind === "conversation_name") {
    return 0
  }
  if (field.kind === "member_name" || field.kind === "member_nickname") {
    return conversation.type === "direct" ? 1 : 2
  }
  if (field.kind === "member_email") {
    return 3
  }
  if (field.kind === "member_phone") {
    return 4
  }
  return 5
}

const matchQualityPriority: Record<ConversationSearchMatchQuality, number> = {
  exact: 0,
  prefix: 1,
  contains: 2,
}

function compareFieldMatches(
  left: {
    fieldPriority: number
    quality: ConversationSearchMatchQuality
  },
  right: {
    fieldPriority: number
    quality: ConversationSearchMatchQuality
  }
) {
  return (
    matchQualityPriority[left.quality] - matchQualityPriority[right.quality] ||
    left.fieldPriority - right.fieldPriority
  )
}

function compareRankedSearchResults(
  left: RankedConversationSearchResult,
  right: RankedConversationSearchResult
) {
  return (
    matchQualityPriority[left.matchQuality] -
      matchQualityPriority[right.matchQuality] ||
    left.fieldPriority - right.fieldPriority ||
    right.recentActivityAt - left.recentActivityAt ||
    left.originalIndex - right.originalIndex
  )
}

function getRecentActivityAt(conversation: ClientConversation) {
  const timestamp = Date.parse(
    conversation.lastMessageAt ?? conversation.createdAt
  )
  return Number.isNaN(timestamp) ? 0 : timestamp
}
