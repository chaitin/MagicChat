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

export function mentionClassName(type: MentionTarget["type"], id: string, currentUserId: string) {
  return type === "all" || (type === "user" && id.toLowerCase() === currentUserId.toLowerCase())
    ? "mx-0.5 font-medium text-amber-600 dark:text-amber-400"
    : "mx-0.5 font-medium text-xgui-link"
}

export function createRemarkMentionPlugin(resolveLabel: MentionLabelResolver) {
  return function remarkMentionPlugin() {
    return function transform(tree: MarkdownNode) {
      replaceTextNodes(tree, resolveLabel)
    }
  }
}

function replaceTextNodes(node: MarkdownNode, resolveLabel: MentionLabelResolver) {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && typeof child.value === "string") {
      return parseMentionTemplate(child.value, resolveLabel).map(
        (part): MarkdownNode =>
          part.type === "text"
            ? { type: "text", value: part.text }
            : {
                type: "mention",
                children: [{ type: "text", value: part.label }],
                data: {
                  hName: "mention",
                  hProperties: {
                    "data-mention-id": part.id,
                    "data-mention-type": part.targetType,
                  },
                },
              },
      )
    }
    if (child.type !== "inlineCode" && child.type !== "code") replaceTextNodes(child, resolveLabel)
    return [child]
  })
}

function resolveMentionLabel(target: MentionTarget, resolveLabel: MentionLabelResolver) {
  if (target.type === "all") return "@所有人"
  const label = resolveLabel(target)?.trim()
  return label ? `@${label}` : target.type === "app" ? "@应用" : "@用户"
}

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
}
