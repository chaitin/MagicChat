export type MentionTarget = {
  id: string
  type: "user" | "app" | "all"
}

export type MentionLabelResolver = (target: MentionTarget) => string | undefined

export type MentionPart =
  | { type: "text"; text: string }
  | { type: "mention"; id: string; targetType: MentionTarget["type"]; label: string }

const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
const tokenPattern = new RegExp(
  `\\{\\(@(?:(user)/(all)|(user|app)/(${uuid}))\\)\\}|\\{\\{@(all|${uuid})\\}\\}`,
  "g",
)

export function parseMentionTemplate(content: string, resolveLabel: MentionLabelResolver) {
  const parts: MentionPart[] = []
  let cursor = 0
  for (const match of content.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push({ type: "text", text: content.slice(cursor, index) })
    const simple = match[5]
    const targetType =
      match[2] === "all" || simple === "all" ? "all" : ((match[3] || "user") as "user" | "app")
    const id = targetType === "all" ? "all" : (match[4] || simple).toLowerCase()
    parts.push({
      type: "mention",
      id,
      targetType,
      label: resolveMentionLabel({ id, type: targetType }, resolveLabel),
    })
    cursor = index + match[0].length
  }
  if (cursor < content.length) parts.push({ type: "text", text: content.slice(cursor) })
  return parts.length > 0 ? parts : [{ type: "text" as const, text: content }]
}

export function formatMentionText(content: string, resolveLabel: MentionLabelResolver) {
  return parseMentionTemplate(content, resolveLabel)
    .map((part) => (part.type === "text" ? part.text : part.label))
    .join("")
}

function resolveMentionLabel(target: MentionTarget, resolveLabel: MentionLabelResolver) {
  if (target.type === "all") return "@所有人"
  const label = resolveLabel(target)?.trim()
  return label ? `@${label}` : target.type === "app" ? "@应用" : "@用户"
}
