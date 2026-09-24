import { pinyin } from "pinyin-pro"
import type { DesktopConversation } from "../../../shared/account-data.ts"
import { parseMentionTemplate, type MentionLabelResolver } from "../../lib/message-mentions.ts"

export type DraftMention = {
  start: number
  end: number
  id: string
  label: string
  targetType: "user" | "app" | "all"
}

export type MentionCandidate = {
  id: string
  label: string
  description: string
  targetType: DraftMention["targetType"]
  searchText: string
}

export function createMentionCandidates(
  conversation: DesktopConversation | null,
  conversations: DesktopConversation[],
): MentionCandidate[] {
  const parent = conversations.find((item) => item.id === conversation?.topic?.parentConversationId)
  if (
    conversation?.type !== "group" &&
    !(
      conversation?.type === "topic" &&
      (conversation.topic?.parentConversationType === "group" || parent?.type === "group")
    )
  )
    return []

  const members = conversation.members?.length ? conversation.members : (parent?.members ?? [])
  const seen = new Set<string>()
  return [
    {
      id: "all",
      label: "所有人",
      description: "所有成员",
      targetType: "all",
      searchText: searchText(["所有人", "全体", "all", "everyone"]),
    },
    ...members.flatMap((member): MentionCandidate[] => {
      if (!/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(member.id)) return []
      const key = `${member.type}:${member.id.toLowerCase()}`
      if (seen.has(key)) return []
      seen.add(key)
      const label = (
        member.type === "app" ? member.name : member.nickname.trim() || member.name
      ).trim()
      if (!label) return []
      return [
        {
          id: member.id,
          label,
          description: member.type === "app" ? "应用" : member.email || member.phone || "成员",
          targetType: member.type,
          searchText: searchText([label, member.name, member.nickname, member.email, member.phone]),
        },
      ]
    }),
  ]
}

export function filterMentionCandidates(candidates: MentionCandidate[], query: string) {
  const normalized = normalize(query)
  return (
    normalized
      ? candidates.filter((candidate) => candidate.searchText.includes(normalized))
      : candidates
  ).slice(0, 50)
}

export function getMentionTrigger(value: string, cursor: number) {
  const start = value.slice(0, cursor).lastIndexOf("@")
  if (start < 0) return null
  const query = value.slice(start + 1, cursor)
  return /[\s@]/.test(query) ? null : { start, query }
}

export function insertDraftMention(
  value: string,
  mentions: DraftMention[],
  target: Pick<MentionCandidate, "id" | "label" | "targetType">,
  start: number,
  end: number,
) {
  const mentionText = `@${target.label}`
  const nextValue = `${value.slice(0, start)}${mentionText} ${value.slice(end)}`
  const nextMention: DraftMention = {
    start,
    end: start + mentionText.length,
    id: target.id,
    label: target.label,
    targetType: target.targetType,
  }
  return {
    value: nextValue,
    cursor: start + mentionText.length + 1,
    mentions: [
      ...syncDraftMentions(
        mentions.filter((mention) => mention.end <= start || mention.start >= end),
        value,
        nextValue,
      ),
      nextMention,
    ].sort((left, right) => left.start - right.start),
  }
}

export function syncDraftMentions(mentions: DraftMention[], previousValue: string, value: string) {
  if (!value) return []
  let start = 0
  while (
    start < previousValue.length &&
    start < value.length &&
    previousValue[start] === value[start]
  )
    start++
  let suffix = 0
  while (
    suffix < previousValue.length - start &&
    suffix < value.length - start &&
    previousValue[previousValue.length - 1 - suffix] === value[value.length - 1 - suffix]
  )
    suffix++
  const oldEnd = previousValue.length - suffix
  const delta = value.length - suffix - oldEnd
  return mentions.flatMap((mention): DraftMention[] => {
    if (previousValue.slice(mention.start, mention.end) !== `@${mention.label}`) return []
    const shifted =
      mention.end <= start
        ? mention
        : mention.start >= oldEnd
          ? { ...mention, start: mention.start + delta, end: mention.end + delta }
          : null
    return shifted && value.slice(shifted.start, shifted.end) === `@${shifted.label}`
      ? [shifted]
      : []
  })
}

export function createDraftMentionTemplate(value: string, mentions: DraftMention[]) {
  let content = value
  for (const mention of [...mentions].sort((left, right) => right.start - left.start)) {
    if (value.slice(mention.start, mention.end) !== `@${mention.label}`) continue
    const token =
      mention.targetType === "all" ? "{(@user/all)}" : `{(@${mention.targetType}/${mention.id})}`
    content = content.slice(0, mention.start) + token + content.slice(mention.end)
  }
  return content
}

export function createDraftFromMessage(content: string, resolveLabel: MentionLabelResolver) {
  const mentions: DraftMention[] = []
  let text = ""
  for (const part of parseMentionTemplate(content, resolveLabel)) {
    if (part.type === "text") {
      text += part.text
      continue
    }
    const start = text.length
    text += part.label
    mentions.push({
      start,
      end: text.length,
      id: part.id,
      label: part.label.slice(1),
      targetType: part.targetType,
    })
  }
  return { text, mentions }
}

function searchText(values: string[]) {
  const tokens = new Set<string>()
  for (const value of values) {
    const normalized = normalize(value)
    if (!normalized) continue
    tokens.add(normalized)
    if (!/[\u3400-\u9fff]/.test(value)) continue
    const syllables = pinyin(value, { toneType: "none", type: "array" })
    tokens.add(normalize(syllables.join("")))
    tokens.add(
      normalize(pinyin(value, { pattern: "first", toneType: "none", type: "array" }).join("")),
    )
  }
  return [...tokens].join(" ")
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}
