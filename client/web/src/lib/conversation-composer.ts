import type { KeyboardEvent } from "react"

import type { ConversationDraftMention } from "@/lib/conversation-drafts"
import { getConversationMemberMentionLabel } from "@/lib/conversation-mention-labels"
import type { ClientConversationMember } from "@/lib/client-data-api"
import type { ConversationPanelMentionTarget } from "@/lib/conversation-panel-types"
import {
  createMentionToken,
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import {
  createPinyinSearchText,
  normalizePinyinSearchQuery,
} from "@/lib/pinyin-search"

const maxMentionCandidateResults = 50

export type MentionCandidate = {
  avatar: string
  description: string
  searchText: string
} & ConversationPanelMentionTarget

export type MentionTrigger = {
  query: string
  start: number
}

export function getClipboardImageFile(clipboardData: DataTransfer) {
  for (const item of Array.from(clipboardData.items)) {
    if (!item.type.startsWith("image/")) {
      continue
    }

    const file = item.getAsFile()

    if (file) {
      return file
    }
  }

  return null
}

export function insertTextareaText(
  textarea: HTMLTextAreaElement,
  text: string,
  onChange: (value: string, cursor: number) => void
) {
  const selectionStart = textarea.selectionStart
  const selectionEnd = textarea.selectionEnd
  const nextValue =
    textarea.value.slice(0, selectionStart) +
    text +
    textarea.value.slice(selectionEnd)
  const nextCursor = selectionStart + text.length

  textarea.value = nextValue
  textarea.setSelectionRange(nextCursor, nextCursor)
  onChange(nextValue, nextCursor)
}

export function isImeCompositionKeyEvent<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(event: KeyboardEvent<T>) {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

export function createMentionCandidates(
  members: ClientConversationMember[]
): MentionCandidate[] {
  const memberCandidates = members
    .map((member): MentionCandidate | null => {
      const label = getConversationMemberMentionLabel(member)
      if (!label) {
        return null
      }

      const description =
        member.type === "app" ? "应用" : member.email || member.phone || "成员"
      const searchText = createPinyinSearchText([
        label,
        member.name,
        member.nickname,
        member.email,
        member.phone,
        member.type,
      ])

      return {
        avatar: member.avatar,
        description,
        id: member.id,
        label,
        searchText,
        targetType: member.type,
      }
    })
    .filter((candidate): candidate is MentionCandidate => candidate !== null)

  return [
    {
      avatar: "",
      description: "所有成员",
      id: "all",
      label: "所有人",
      searchText: createPinyinSearchText(["所有人", "全体", "all", "everyone"]),
      targetType: "all",
    },
    ...memberCandidates,
  ]
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string
) {
  const normalizedQuery = normalizePinyinSearchQuery(query)
  const filteredCandidates = normalizedQuery
    ? candidates.filter((candidate) =>
        candidate.searchText.includes(normalizedQuery)
      )
    : candidates

  return filteredCandidates.slice(0, maxMentionCandidateResults)
}

export function getVisibleMentionIndex(index: number, length: number) {
  if (length <= 0) {
    return 0
  }

  return Math.min(index, length - 1)
}

export function getMentionTrigger(
  value: string,
  cursor: number
): MentionTrigger | null {
  const beforeCursor = value.slice(0, cursor)
  const start = beforeCursor.lastIndexOf("@")
  if (start < 0) {
    return null
  }

  const query = value.slice(start + 1, cursor)
  if (/[\s@]/.test(query)) {
    return null
  }

  return {
    query,
    start,
  }
}

export function insertDraftMention(
  value: string,
  mentions: ConversationDraftMention[],
  target: ConversationPanelMentionTarget,
  selectionStart: number,
  selectionEnd: number
) {
  const mentionText = `@${target.label}`
  const insertedText = `${mentionText} `
  const nextValue =
    value.slice(0, selectionStart) + insertedText + value.slice(selectionEnd)
  const nextMention: ConversationDraftMention = {
    end: selectionStart + mentionText.length,
    id: target.id,
    label: target.label,
    start: selectionStart,
    targetType: target.targetType,
  }
  const nextMentions = [
    ...syncDraftMentions(
      mentions.filter(
        (mention) =>
          mention.end <= selectionStart || mention.start >= selectionEnd
      ),
      value,
      nextValue
    ),
    nextMention,
  ].sort((mentionA, mentionB) => mentionA.start - mentionB.start)

  return {
    cursor: selectionStart + insertedText.length,
    mentions: nextMentions,
    value: nextValue,
  }
}

export function syncDraftMentions(
  mentions: ConversationDraftMention[],
  previousValue: string,
  value: string
): ConversationDraftMention[] {
  if (!value) {
    return []
  }

  const textChange = getTextChange(previousValue, value)
  const nextMentions: ConversationDraftMention[] = []

  for (const mention of mentions) {
    const text = getDraftMentionText(mention)
    if (previousValue.slice(mention.start, mention.end) !== text) {
      continue
    }

    const nextMention = shiftDraftMention(mention, textChange)

    if (!nextMention) {
      continue
    }

    if (value.slice(nextMention.start, nextMention.end) === text) {
      nextMentions.push(nextMention)
    }
  }

  return nextMentions
}

type TextChange = {
  delta: number
  newEnd: number
  oldEnd: number
  start: number
}

function getTextChange(previousValue: string, value: string): TextChange {
  let start = 0
  while (
    start < previousValue.length &&
    start < value.length &&
    previousValue[start] === value[start]
  ) {
    start += 1
  }

  let unchangedSuffixLength = 0
  while (
    unchangedSuffixLength < previousValue.length - start &&
    unchangedSuffixLength < value.length - start &&
    previousValue[previousValue.length - 1 - unchangedSuffixLength] ===
      value[value.length - 1 - unchangedSuffixLength]
  ) {
    unchangedSuffixLength += 1
  }

  const oldEnd = previousValue.length - unchangedSuffixLength
  const newEnd = value.length - unchangedSuffixLength

  return {
    delta: newEnd - oldEnd,
    newEnd,
    oldEnd,
    start,
  }
}

function shiftDraftMention(
  mention: ConversationDraftMention,
  textChange: TextChange
) {
  if (mention.end <= textChange.start) {
    return mention
  }

  if (mention.start >= textChange.oldEnd) {
    return {
      ...mention,
      end: mention.end + textChange.delta,
      start: mention.start + textChange.delta,
    }
  }

  return null
}

export function createDraftMentionTemplate(
  value: string,
  mentions: ConversationDraftMention[]
) {
  let content = value
  const validMentions = mentions
    .filter(
      (mention) =>
        value.slice(mention.start, mention.end) === getDraftMentionText(mention)
    )
    .sort((mentionA, mentionB) => mentionB.start - mentionA.start)

  for (const mention of validMentions) {
    content =
      content.slice(0, mention.start) +
      createMentionToken({
        id: mention.id,
        type: mention.targetType,
      }) +
      content.slice(mention.end)
  }

  return content
}

export function createDraftFromMessageContent(
  content: string,
  mentionLabelResolver: MentionLabelResolver
) {
  const mentions: ConversationDraftMention[] = []
  let text = ""

  for (const part of parseMentionTemplate(content, mentionLabelResolver)) {
    if (part.type === "text") {
      text += part.text
      continue
    }

    const start = text.length
    text += part.label
    mentions.push({
      end: text.length,
      id: part.id,
      label: part.label.slice(1),
      start,
      targetType: part.targetType,
    })
  }

  return { mentions, text }
}

function getDraftMentionText(mention: Pick<ConversationDraftMention, "label">) {
  return `@${mention.label}`
}
