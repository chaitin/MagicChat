import type { MentionTargetType } from "@/lib/message-mentions"

export const conversationDraftMaxAgeMs = 7 * 24 * 60 * 60 * 1000

const conversationDraftStorageVersion = 1
const conversationDraftStorageKeyPrefix =
  "dianbao:client:conversation-drafts:v1:"

export type ConversationDraftMention = {
  end: number
  id: string
  label: string
  start: number
  targetType: MentionTargetType
}

export type ConversationDraftReplyTarget = {
  author: string
  id: string
  summary: string
}

export type ConversationDraftContent = {
  mentions: ConversationDraftMention[]
  replyTarget: ConversationDraftReplyTarget | null
  text: string
}

export type ConversationDraft = ConversationDraftContent & {
  updatedAt: number
}

export type ConversationDrafts = Record<string, ConversationDraft>

type StoredConversationDrafts = {
  drafts: ConversationDrafts
  version: typeof conversationDraftStorageVersion
}

export const emptyConversationDraft: ConversationDraftContent = {
  mentions: [],
  replyTarget: null,
  text: "",
}

export function isConversationDraftEmpty(draft: ConversationDraftContent) {
  return (
    draft.text.length === 0 &&
    draft.mentions.length === 0 &&
    draft.replyTarget === null
  )
}

export function readConversationDrafts(
  userId: string,
  now = Date.now()
): ConversationDrafts {
  if (typeof window === "undefined" || !userId) {
    return {}
  }

  const storageKey = getConversationDraftStorageKey(userId)

  try {
    const rawDrafts = window.localStorage.getItem(storageKey)
    if (!rawDrafts) {
      return {}
    }

    const parsed = JSON.parse(rawDrafts) as unknown
    if (!isStoredConversationDrafts(parsed)) {
      window.localStorage.removeItem(storageKey)
      return {}
    }

    const drafts = Object.fromEntries(
      Object.entries(parsed.drafts).flatMap(([conversationId, value]) => {
        const draft = normalizeConversationDraft(value)
        if (
          !conversationId ||
          !draft ||
          now - draft.updatedAt > conversationDraftMaxAgeMs
        ) {
          return []
        }

        return [[conversationId, draft]]
      })
    )
    const normalized: StoredConversationDrafts = {
      drafts,
      version: conversationDraftStorageVersion,
    }

    if (JSON.stringify(normalized) !== rawDrafts) {
      writeConversationDrafts(userId, drafts)
    }

    return drafts
  } catch {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Invalid storage must not prevent the chat page from loading.
    }

    return {}
  }
}

export function writeConversationDrafts(
  userId: string,
  drafts: ConversationDrafts
) {
  if (typeof window === "undefined" || !userId) {
    return false
  }

  try {
    const storageKey = getConversationDraftStorageKey(userId)

    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(storageKey)
      return true
    }

    const storedDrafts: StoredConversationDrafts = {
      drafts,
      version: conversationDraftStorageVersion,
    }
    window.localStorage.setItem(storageKey, JSON.stringify(storedDrafts))
    return true
  } catch {
    return false
  }
}

function getConversationDraftStorageKey(userId: string) {
  return `${conversationDraftStorageKeyPrefix}${encodeURIComponent(userId)}`
}

function isStoredConversationDrafts(
  value: unknown
): value is { drafts: Record<string, unknown>; version: number } {
  return (
    isRecord(value) &&
    value.version === conversationDraftStorageVersion &&
    isRecord(value.drafts)
  )
}

function normalizeConversationDraft(value: unknown): ConversationDraft | null {
  if (!isRecord(value)) {
    return null
  }

  const text = value.text
  const updatedAt = value.updatedAt

  if (
    typeof text !== "string" ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt)
  ) {
    return null
  }

  const mentions = Array.isArray(value.mentions)
    ? value.mentions.flatMap((mention) => {
        const normalizedMention = normalizeConversationDraftMention(
          mention,
          text
        )
        return normalizedMention ? [normalizedMention] : []
      })
    : []

  return {
    mentions,
    replyTarget: normalizeConversationDraftReplyTarget(value.replyTarget),
    text,
    updatedAt,
  }
}

function normalizeConversationDraftMention(
  value: unknown,
  text: string
): ConversationDraftMention | null {
  if (!isRecord(value)) {
    return null
  }

  const end = value.end
  const id = value.id
  const label = value.label
  const start = value.start
  const targetType = value.targetType

  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    typeof id !== "string" ||
    typeof label !== "string" ||
    !isMentionTargetType(targetType) ||
    text.slice(start, end) !== `@${label}`
  ) {
    return null
  }

  return {
    end,
    id,
    label,
    start,
    targetType,
  }
}

function normalizeConversationDraftReplyTarget(
  value: unknown
): ConversationDraftReplyTarget | null {
  if (value === null || value === undefined) {
    return null
  }

  if (
    !isRecord(value) ||
    typeof value.author !== "string" ||
    typeof value.id !== "string" ||
    typeof value.summary !== "string"
  ) {
    return null
  }

  return {
    author: value.author,
    id: value.id,
    summary: value.summary,
  }
}

function isMentionTargetType(value: unknown): value is MentionTargetType {
  return value === "all" || value === "app" || value === "user"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
