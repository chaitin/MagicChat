import { useRouter } from "expo-router"
import MarkdownIt from "markdown-it"
import type Token from "markdown-it/lib/token.mjs"
import { memo, useMemo, type ReactNode } from "react"
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"

import type { EntityReference } from "@/domain/entities/entity-profile"
import type { MessageMentionLabelResolver } from "@/domain/messages/message-presenter"
import { MessageMentionText } from "@/features/conversation/messages/message-mention-text"
import { buildUrlImagePreviewHref } from "@/navigation/image-preview"
import { useXGUITheme } from "@/xgui"

type MarkdownNode = {
  children: MarkdownNode[]
  token: Token
}

type MarkdownRenderContext = {
  backgroundPress: string
  borderColor: string
  codeColor: string
  currentUserId: string
  linkColor: ReturnType<typeof useXGUITheme>["colors"]["link"]
  onMentionPress: (target: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
  selectable: boolean
  serverUrl: string
  textColor: ReturnType<typeof useXGUITheme>["colors"]["textPrimary"]
}

const markdownParser = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
})

const horizontalScrollStyle = { flexGrow: 0, flexShrink: 0 } as const

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  currentUserId,
  onMentionPress,
  resolveMentionLabel,
  selectable = true,
  serverUrl,
}: {
  content: string
  currentUserId: string
  onMentionPress: (target: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
  selectable?: boolean
  serverUrl: string
}) {
  const { colors } = useXGUITheme()
  const nodes = useMemo(() => {
    try {
      return buildTokenTree(markdownParser.parse(content, {}))
    } catch {
      return []
    }
  }, [content])

  if (nodes.length === 0) {
    return (
      <Text selectable={selectable} style={[styles.text, { color: colors.textPrimary }]}>
        <MessageMentionText
          content={content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
        />
      </Text>
    )
  }

  const context: MarkdownRenderContext = {
    backgroundPress: colors.background1,
    borderColor: colors.separator,
    codeColor: colors.brand5,
    currentUserId,
    linkColor: colors.link,
    onMentionPress,
    resolveMentionLabel,
    selectable,
    serverUrl,
    textColor: colors.textPrimary,
  }

  return (
    <View style={{ gap: 7, maxWidth: "100%" }}>
      {renderBlockNodes(nodes, context)}
    </View>
  )
})

function buildTokenTree(tokens: Token[]) {
  const roots: MarkdownNode[] = []
  const childStack: MarkdownNode[][] = [roots]

  for (const token of tokens) {
    if (token.nesting === -1) {
      if (childStack.length > 1) {
        childStack.pop()
      }
      continue
    }

    const node: MarkdownNode = { children: [], token }
    childStack[childStack.length - 1].push(node)

    if (token.nesting === 1) {
      childStack.push(node.children)
    }
  }

  return roots
}

function renderBlockNodes(
  nodes: MarkdownNode[],
  context: MarkdownRenderContext
) {
  return nodes.map((node, index) =>
    renderBlockNode(
      node,
      `${node.token.type}:${node.token.map?.[0] ?? index}:${index}`,
      context
    )
  )
}

function renderBlockNode(
  node: MarkdownNode,
  key: string,
  context: MarkdownRenderContext
): ReactNode {
  const { token } = node

  if (token.type === "paragraph_open") {
    return renderParagraph(node, key, context)
  }

  if (token.type === "heading_open") {
    return (
      <Text key={key} style={[styles.text, { color: context.textColor, fontWeight: "600" }]}>
        {renderNodeInlineContent(node, context)}
      </Text>
    )
  }

  if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
    return renderList(
      node,
      key,
      token.type === "ordered_list_open",
      context
    )
  }

  if (token.type === "list_item_open") {
    return (
      <View key={key} style={{ flex: 1, gap: 7 }}>
        {renderBlockNodes(node.children, context)}
      </View>
    )
  }

  if (token.type === "blockquote_open") {
    return (
      <View key={key} style={{ backgroundColor: context.backgroundPress, borderColor: context.borderColor, borderLeftWidth: 3, gap: 7, padding: 7, paddingLeft: 13 }}>
        {renderBlockNodes(node.children, context)}
      </View>
    )
  }

  if (token.type === "fence" || token.type === "code_block") {
    return <MarkdownCodeBlock context={context} key={key} token={token} />
  }

  if (token.type === "hr") {
    return <View key={key} style={{ backgroundColor: context.borderColor, height: StyleSheet.hairlineWidth }} />
  }

  if (token.type === "table_open") {
    return (
      <MarkdownTable
        key={key}
        node={node}
        context={context}
      />
    )
  }

  if (token.type === "inline") {
    return (
      <Text key={key} selectable={context.selectable} style={[styles.text, { color: context.textColor }]}>
        {renderInlineTokens(
          token.children ?? [],
          context
        )}
      </Text>
    )
  }

  if (node.children.length > 0) {
    return (
      <View key={key} style={{ gap: 7 }}>
        {renderBlockNodes(node.children, context)}
      </View>
    )
  }

  return token.content ? (
    <Text key={key} selectable={context.selectable} style={[styles.text, { color: context.textColor }]}>
      <MessageMentionText
        content={token.content}
        currentUserId={context.currentUserId}
        onMentionPress={context.onMentionPress}
        resolveMentionLabel={context.resolveMentionLabel}
      />
    </Text>
  ) : null
}

function renderParagraph(
  node: MarkdownNode,
  key: string,
  context: MarkdownRenderContext
) {
  const inlineToken = node.children.find((child) => child.token.type === "inline")
    ?.token
  const inlineTokens = inlineToken?.children ?? []
  const imageTokens = inlineTokens.filter((token) => token.type === "image")
  const hasText = inlineTokens.some(
    (token) =>
      token.type !== "image" &&
      token.nesting === 0 &&
      (token.content.trim().length > 0 || token.type === "softbreak")
  )

  return (
    <View key={key} style={{ gap: 7 }}>
      {hasText || imageTokens.length === 0 ? (
        <Text selectable={context.selectable} style={[styles.text, { color: context.textColor }]}>
          {renderInlineTokens(inlineTokens, context)}
        </Text>
      ) : null}
      {imageTokens.map((token, index) => (
        <MarkdownImage
          key={`${key}:image:${token.attrGet("src") ?? index}`}
          serverUrl={context.serverUrl}
          token={token}
        />
      ))}
    </View>
  )
}

function renderList(
  node: MarkdownNode,
  key: string,
  ordered: boolean,
  context: MarkdownRenderContext
) {
  const items = node.children.filter(
    (child) => child.token.type === "list_item_open"
  )
  const start = Number(node.token.attrGet("start") ?? "1") || 1

  return (
    <View key={key} style={{ gap: 7 }}>
      {items.map((item, index) => (
        <View key={`${key}:item:${index}`} style={{ alignItems: "flex-start", flexDirection: "row", gap: 7, maxWidth: "100%" }}>
          <Text style={[styles.text, { color: context.textColor, minWidth: ordered ? 22 : 10, textAlign: "right" }]}>
            {ordered ? `${start + index}.` : "•"}
          </Text>
          <View style={{ flexShrink: 1, gap: 7, minWidth: 0 }}>
            {renderBlockNodes(item.children, context)}
          </View>
        </View>
      ))}
    </View>
  )
}

function MarkdownCodeBlock({
  context,
  token,
}: {
  context: MarkdownRenderContext
  token: Token
}) {
  const language = token.info.trim().split(/\s+/, 1)[0]

  return (
    <View style={{ backgroundColor: context.backgroundPress, borderColor: context.borderColor, borderRadius: 7, borderWidth: 1, gap: 7, overflow: "hidden" }}>
      {language ? (
        <Text style={[styles.text, { color: context.codeColor, paddingHorizontal: 13, paddingTop: 7 }]}>
          {language}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={horizontalScrollStyle}
      >
        <Text selectable={context.selectable} style={[styles.text, { fontFamily: "monospace", padding: 13 }]}>
          {token.content.replace(/\n$/, "")}
        </Text>
      </ScrollView>
    </View>
  )
}

function MarkdownTable({
  context,
  node,
}: {
  context: MarkdownRenderContext
  node: MarkdownNode
}) {
  const rows = collectNodes(node, "tr_open")

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={horizontalScrollStyle}
    >
      <View style={{ borderColor: context.borderColor, borderTopWidth: 1, minWidth: 280 }}>
        {rows.map((row, rowIndex) => {
          const cells = row.children.filter(
            (child) =>
              child.token.type === "th_open" || child.token.type === "td_open"
          )

          return (
            <View key={`row:${rowIndex}`} style={{ flexDirection: "row" }}>
              {cells.map((cell, cellIndex) => (
                <View key={`cell:${rowIndex}:${cellIndex}`} style={{ backgroundColor: cell.token.type === "th_open" ? context.backgroundPress : undefined, borderBottomWidth: 1, borderColor: context.borderColor, borderLeftWidth: cellIndex === 0 ? 1 : 0, borderRightWidth: 1, padding: 7, width: 140 }}>
                  <Text style={[styles.text, { color: context.textColor, fontWeight: cell.token.type === "th_open" ? "600" : "400" }]}>
                    {renderNodeInlineContent(cell, context)}
                  </Text>
                </View>
              ))}
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function MarkdownImage({ serverUrl, token }: { serverUrl: string; token: Token }) {
  const router = useRouter()
  const { colors } = useXGUITheme()
  const source = resolveMarkdownUrl(token.attrGet("src") ?? "", serverUrl)
  const alt = token.content.trim() || "图片"

  if (!source || !/^https?:/i.test(source)) {
    return (
      <Text style={[styles.text, { color: colors.textPlaceholder }]}>{alt}</Text>
    )
  }

  return (
    <Pressable accessibilityLabel={alt} accessibilityRole="button" onPress={() => router.push(buildUrlImagePreviewHref(source))}>
      <Image resizeMode="contain" source={{ uri: source }} style={{ borderRadius: 7, height: 160, width: 220 }} />
    </Pressable>
  )
}

function renderNodeInlineContent(
  node: MarkdownNode,
  context: MarkdownRenderContext
) {
  const inlineToken = node.children.find((child) => child.token.type === "inline")
    ?.token

  return renderInlineTokens(
    inlineToken?.children ?? [],
    context
  )
}

function renderInlineTokens(
  tokens: Token[],
  context: MarkdownRenderContext
) {
  return buildTokenTree(tokens).map((node, index) =>
    renderInlineNode(
      node,
      `${node.token.type}:${index}`,
      context,
      context.textColor
    )
  )
}

function renderInlineNode(
  node: MarkdownNode,
  key: string,
  context: MarkdownRenderContext,
  color:
    | MarkdownRenderContext["linkColor"]
    | MarkdownRenderContext["textColor"]
): ReactNode {
  const { token } = node
  const childColor = token.type === "link_open" ? context.linkColor : color
  const children = node.children.map((child, index) =>
    renderInlineNode(
      child,
      `${key}:${child.token.type}:${index}`,
      context,
      childColor
    )
  )

  if (token.type === "text") {
    return (
      <MessageMentionText
        content={formatTaskMarker(token.content)}
        currentUserId={context.currentUserId}
        key={key}
        onMentionPress={context.onMentionPress}
        resolveMentionLabel={context.resolveMentionLabel}
      />
    )
  }
  if (token.type === "softbreak") {
    return " "
  }
  if (token.type === "hardbreak") {
    return "\n"
  }
  if (token.type === "code_inline") {
    return (
      <Text key={key} style={[styles.text, { color: context.codeColor, fontFamily: "monospace" }]}>
        {token.content}
      </Text>
    )
  }
  if (token.type === "strong_open") {
    return (
      <Text key={key} style={[styles.text, { color, fontWeight: "600" }]}>
        {children}
      </Text>
    )
  }
  if (token.type === "em_open") {
    return (
      <Text key={key} style={[styles.text, { color, fontStyle: "italic" }]}>
        {children}
      </Text>
    )
  }
  if (token.type === "s_open") {
    return (
      <Text key={key} style={[styles.text, { color, textDecorationLine: "line-through" }]}>
        {children}
      </Text>
    )
  }
  if (token.type === "link_open") {
    const url = resolveMarkdownUrl(
      token.attrGet("href") ?? "",
      context.serverUrl
    )
    return (
      <Text key={key} onPress={url ? () => void openMarkdownUrl(url) : undefined} style={[styles.text, { color: context.linkColor }]}>
        {children}
      </Text>
    )
  }
  if (token.type === "image") {
    return null
  }

  if (children.length > 0) {
    return <Text key={key} style={[styles.text, { color }]}>{children}</Text>
  }

  return token.content ? (
    <MessageMentionText
      content={token.content}
      currentUserId={context.currentUserId}
      key={key}
      onMentionPress={context.onMentionPress}
      resolveMentionLabel={context.resolveMentionLabel}
    />
  ) : null
}

function collectNodes(node: MarkdownNode, type: string): MarkdownNode[] {
  const matches = node.token.type === type ? [node] : []
  return [
    ...matches,
    ...node.children.flatMap((child) => collectNodes(child, type)),
  ]
}

function formatTaskMarker(value: string) {
  return value
    .replace(/^\[ \]\s+/, "☐ ")
    .replace(/^\[[xX]]\s+/, "☑ ")
}

function resolveMarkdownUrl(value: string, serverUrl: string) {
  try {
    const url = new URL(value.trim(), `${serverUrl.replace(/\/+$/, "")}/`)
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? url.toString()
      : ""
  } catch {
    return ""
  }
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 23 },
})

async function openMarkdownUrl(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    // Invalid or unsupported links stay inert inside the message.
  }
}
