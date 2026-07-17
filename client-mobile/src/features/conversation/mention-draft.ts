import {
  createMessageMentionToken,
  type MessageMentionTargetType,
} from "@/domain/messages/message-mentions"

export type MentionSelection = {
  id: string
  label: string
  targetType: MessageMentionTargetType
}

export type DraftMention = MentionSelection & {
  end: number
  start: number
}

export type TextSelection = {
  end: number
  start: number
}

export type MentionTrigger = {
  end: number
  start: number
}

export function findInsertedMentionTrigger(
  previousValue: string,
  value: string
): MentionTrigger | null {
  const change = getTextChange(previousValue, value)
  const insertedText = value.slice(change.start, change.newEnd)
  if (!insertedText.endsWith("@")) return null

  const trigger = getMentionTrigger(value, change.newEnd)
  return trigger?.query === ""
    ? { end: change.newEnd, start: trigger.start }
    : null
}

export function getCursorAfterTextChange(
  previousValue: string,
  value: string
) {
  return getTextChange(previousValue, value).newEnd
}

export function insertDraftMention({
  mentions,
  selection,
  target,
  value,
}: {
  mentions: DraftMention[]
  selection: TextSelection
  target: MentionSelection
  value: string
}) {
  const mentionText = `@${target.label}`
  const insertedText = `${mentionText} `
  const nextValue =
    value.slice(0, selection.start) +
    insertedText +
    value.slice(selection.end)
  const nextMention: DraftMention = {
    ...target,
    end: selection.start + mentionText.length,
    start: selection.start,
  }
  const retainedMentions = mentions.filter(
    (mention) =>
      mention.end <= selection.start || mention.start >= selection.end
  )
  const nextMentions = [
    ...syncDraftMentions(retainedMentions, value, nextValue),
    nextMention,
  ].sort((left, right) => left.start - right.start)

  return {
    cursor: selection.start + insertedText.length,
    mentions: nextMentions,
    value: nextValue,
  }
}

export function syncDraftMentions(
  mentions: DraftMention[],
  previousValue: string,
  value: string
): DraftMention[] {
  if (!value) return []

  const textChange = getTextChange(previousValue, value)
  const nextMentions: DraftMention[] = []

  for (const mention of mentions) {
    const text = getDraftMentionText(mention)
    if (previousValue.slice(mention.start, mention.end) !== text) continue

    const nextMention = shiftDraftMention(mention, textChange)
    if (
      nextMention &&
      value.slice(nextMention.start, nextMention.end) === text
    ) {
      nextMentions.push(nextMention)
    }
  }

  return nextMentions
}

export function createDraftMentionTemplate(
  value: string,
  mentions: DraftMention[]
) {
  let content = value
  const validMentions = mentions
    .filter(
      (mention) =>
        value.slice(mention.start, mention.end) === getDraftMentionText(mention)
    )
    .sort((left, right) => right.start - left.start)

  for (const mention of validMentions) {
    content =
      content.slice(0, mention.start) +
      createMessageMentionToken({ id: mention.id, type: mention.targetType }) +
      content.slice(mention.end)
  }

  return content
}

function getMentionTrigger(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const start = beforeCursor.lastIndexOf("@")
  if (start < 0) return null

  const query = value.slice(start + 1, cursor)
  if (/[\s@]/.test(query)) return null

  return { query, start }
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
  return { delta: newEnd - oldEnd, newEnd, oldEnd, start }
}

function shiftDraftMention(mention: DraftMention, change: TextChange) {
  if (mention.end <= change.start) return mention

  if (mention.start >= change.oldEnd) {
    return {
      ...mention,
      end: mention.end + change.delta,
      start: mention.start + change.delta,
    }
  }

  return null
}

function getDraftMentionText(mention: Pick<DraftMention, "label">) {
  return `@${mention.label}`
}
