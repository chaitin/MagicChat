export type MessageMentionTargetType = "all" | "app" | "user"

export type MessageMentionTarget = {
  id: string
  type: MessageMentionTargetType
}

export type MessageMentionLabelResolver = (
  target: MessageMentionTarget
) => string | undefined

export type MessageMentionTemplatePart =
  | { text: string; type: "text" }
  | {
      id: string
      label: string
      targetType: MessageMentionTargetType
      type: "mention"
    }

const mentionTokenPattern =
  /\{\(@(?:(user)\/(all)|(user|app)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))\)\}/g

export function createMessageMentionToken(target: MessageMentionTarget) {
  if (target.type === "all") return "{(@user/all)}"
  return `{(@${target.type}/${target.id})}`
}

export function parseMessageMentionTemplate(
  content: string,
  resolveLabel: MessageMentionLabelResolver
): MessageMentionTemplatePart[] {
  const parts: MessageMentionTemplatePart[] = []
  let cursor = 0

  for (const match of content.matchAll(mentionTokenPattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      parts.push({ text: content.slice(cursor, index), type: "text" })
    }

    const targetType = (match[2] === "all" ? "all" : match[3]) as
      | MessageMentionTargetType
      | undefined
    const id = targetType === "all" ? "all" : match[4]?.toLowerCase()

    if (targetType && id) {
      parts.push({
        id,
        label: resolveMessageMentionLabel(
          { id, type: targetType },
          resolveLabel
        ),
        targetType,
        type: "mention",
      })
    } else {
      parts.push({ text: match[0], type: "text" })
    }

    cursor = index + match[0].length
  }

  if (cursor < content.length) {
    parts.push({ text: content.slice(cursor), type: "text" })
  }

  return parts.length > 0 ? parts : [{ text: content, type: "text" }]
}

export function formatMentionTemplateText(
  content: string,
  resolveLabel: MessageMentionLabelResolver
) {
  return parseMessageMentionTemplate(content, resolveLabel)
    .map((part) => (part.type === "mention" ? part.label : part.text))
    .join("")
}

function resolveMessageMentionLabel(
  target: MessageMentionTarget,
  resolveLabel: MessageMentionLabelResolver
) {
  if (target.type === "all") return "@所有人"

  const label = resolveLabel(target)?.trim()
  if (label) return `@${label}`
  return target.type === "app" ? "@应用" : "@用户"
}
