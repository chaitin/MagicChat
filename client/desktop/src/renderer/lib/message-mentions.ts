import {
  parseMentionTemplate,
  type MentionLabelResolver,
  type MentionTarget,
} from "../../shared/message-mentions.ts"

export { formatMentionText, parseMentionTemplate } from "../../shared/message-mentions.ts"
export type {
  MentionLabelResolver,
  MentionPart,
  MentionTarget,
} from "../../shared/message-mentions.ts"

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

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
}
