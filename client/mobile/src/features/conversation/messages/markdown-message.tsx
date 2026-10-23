import { useRouter } from "expo-router"
import { Check } from "lucide-react-native"
import MarkdownIt from "markdown-it"
import type Token from "markdown-it/lib/token.mjs"
import { memo, useMemo, useState, type ReactNode } from "react"
import { Image, Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type TextStyle } from "react-native"
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
  backgroundColor: string
  borderColor: string
  codeBackground: string
  quoteBackground: string
  foregroundColor: string
  secondaryTextColor: string
  fontSize: number
  lineHeight: number
  inlineStyle?: Pick<TextStyle, "fontWeight" | "fontStyle" | "textDecorationLine">
  currentUserId: string
  linkColor: ReturnType<typeof useXGUITheme>["colors"]["link"]
  onMentionPress: (target: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
  selectable: boolean
  serverUrl: string
  textColor: string
}

const markdownParser = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
})

const horizontalScrollStyle = { flexGrow: 0, flexShrink: 0 } as const
const headingFontSizes: Record<string, number> = { h1: 24, h2: 20, h3: 18, h4: 16, h5: 14, h6: 14 }

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
  const { colors, colorScheme } = useXGUITheme()
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
          autoLink={false}
          content={content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
        />
      </Text>
    )
  }

  const foreground = colorScheme === "dark" ? "255,255,255" : "0,0,0"
  const foregroundAlpha = colorScheme === "dark" ? 0.8 : 0.9
  const context: MarkdownRenderContext = {
    backgroundColor: colors.background2,
    borderColor: colors.separator,
    codeBackground: `rgba(${foreground},${(foregroundAlpha * 0.08).toFixed(3)})`,
    quoteBackground: `rgba(${foreground},${(foregroundAlpha * 0.05).toFixed(3)})`,
    foregroundColor: colors.textPrimary,
    secondaryTextColor: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    currentUserId,
    linkColor: colors.link,
    onMentionPress,
    resolveMentionLabel,
    selectable,
    serverUrl,
    textColor: colors.textPrimary,
  }

  return (
    <View style={{ gap: 16, maxWidth: "100%" }}>
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
    const fontSize = headingFontSizes[token.tag] ?? 15
    return (
      <Text key={key} selectable={context.selectable} style={{ color: context.textColor, fontSize, fontWeight: "600", lineHeight: Math.round(fontSize * 1.375), opacity: token.tag === "h6" ? 0.8 : 1 }}>
        {renderNodeInlineContent(node, { ...context, fontSize, lineHeight: Math.round(fontSize * 1.375), inlineStyle: { ...context.inlineStyle, fontWeight: "600" } })}
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
      <View key={key} style={{ flex: 1 }}>
        {renderBlockNodes(node.children, context)}
      </View>
    )
  }

  if (token.type === "blockquote_open") {
    return (
      <View key={key} style={{ backgroundColor: context.quoteBackground, borderColor: context.borderColor, borderLeftWidth: 2, paddingVertical: 8, paddingLeft: 12 }}>
        {renderBlockNodes(node.children, { ...context, textColor: context.secondaryTextColor })}
      </View>
    )
  }

  if (token.type === "fence" || token.type === "code_block") {
    return <MarkdownCodeBlock context={context} key={key} token={token} />
  }

  if (token.type === "hr") {
    return <View key={key} style={{ backgroundColor: context.foregroundColor, height: 1, opacity: 0.2 }} />
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
      <View key={key} style={{ gap: 16 }}>
        {renderBlockNodes(node.children, context)}
      </View>
    )
  }

  return token.content ? (
    <Text key={key} selectable={context.selectable} style={[styles.text, { color: context.textColor }]}>
      <MessageMentionText
        autoLink={false}
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
  const parts = splitParagraphImages(inlineToken?.children ?? [])

  return (
    <View key={key}>
      {parts.map((part, index) => "image" in part ? (
        <MarkdownImage key={`${key}:image:${index}:${part.image.attrGet("src")}`} serverUrl={context.serverUrl} token={part.image} />
      ) : (
        <Text key={`${key}:text:${index}`} selectable={context.selectable} style={[styles.text, { color: context.textColor }]}>
          {renderInlineTokens(part.tokens, context)}
        </Text>
      ))}
    </View>
  )
}

function splitParagraphImages(tokens: Token[]) {
  const parts: ({ image: Token } | { tokens: Token[] })[] = []
  const openTokens: Token[] = []
  let current: Token[] = []
  function flush() {
    if (current.some((token) => token.nesting === 0 && (token.content.trim() || token.type === "hardbreak"))) {
      parts.push({ tokens: current })
    }
  }
  for (const token of tokens) {
    if (token.type === "image") {
      flush()
      parts.push({ image: token })
      current = [...openTokens]
    } else {
      current.push(token)
      if (token.nesting === 1) openTokens.push(token)
      else if (token.nesting === -1) openTokens.pop()
    }
  }
  flush()
  return parts
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
    <View key={key} style={{ gap: 4 }}>
      {items.map((item, index) => {
        const task = parseTaskListItem(item)
        // Outside markers keep all item bodies aligned, independently of the counter's width.
        return (
          <View key={`${key}:item:${index}`} style={task
            ? { alignItems: "flex-start", flexDirection: "row", gap: 8, marginLeft: ordered ? 20 : 0, maxWidth: "100%", minWidth: 0 }
            : { marginLeft: 20, maxWidth: "100%", minWidth: 0, paddingLeft: 4 }}>
            {task ? (
              <View
                accessible
                accessibilityLabel={task.checked ? "已完成" : "未完成"}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: task.checked, disabled: true }}
                pointerEvents="none"
                style={{ alignItems: "center", backgroundColor: task.checked ? context.foregroundColor : "transparent", borderColor: task.checked ? context.foregroundColor : context.borderColor, borderRadius: 4, borderWidth: 1, flexShrink: 0, height: 16, justifyContent: "center", marginTop: 2, width: 16 }}
              >
                {task.checked ? <Check color={context.backgroundColor} size={14} strokeWidth={2} /> : null}
              </View>
            ) : (
              <Text style={[styles.text, { color: context.textColor, marginRight: 4, position: "absolute", right: "100%", textAlign: "right", top: 0 }]}>
                {ordered ? `${start + index}.` : "•"}
              </Text>
            )}
            <View style={{ ...(task ? { flexShrink: 1 } : {}), minWidth: 0 }}>
              {renderBlockNodes(task?.children ?? item.children, context)}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function parseTaskListItem(item: MarkdownNode) {
  const paragraph = item.children[0]
  if (paragraph?.token.type !== "paragraph_open") return null
  const inline = paragraph.children.find((child) => child.token.type === "inline")
  const tokens = inline?.token.children
  const first = tokens?.[0]
  if (!inline || !tokens || first?.type !== "text") return null
  const marker = /^\[([ xX])\](?:[ \t]+|$)/.exec(first.content)
  if (!marker) return null
  const text = Object.assign(Object.create(Object.getPrototypeOf(first)), first, { content: first.content.slice(marker[0].length) }) as Token
  const inlineToken = Object.assign(Object.create(Object.getPrototypeOf(inline.token)), inline.token, { children: [text, ...tokens.slice(1)] }) as Token
  return {
    checked: marker[1].toLowerCase() === "x",
    children: [
      { ...paragraph, children: paragraph.children.map((child) => child === inline ? { ...inline, token: inlineToken } : child) },
      ...item.children.slice(1),
    ],
  }
}

function MarkdownCodeBlock({
  context,
  token,
}: {
  context: MarkdownRenderContext
  token: Token
}) {
  return (
    <View style={{ backgroundColor: context.codeBackground, borderRadius: 4, overflow: "hidden" }}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={horizontalScrollStyle}
      >
        <Text selectable={context.selectable} style={[styles.text, { color: context.textColor, fontFamily: "JetBrainsMono", fontSize: 14, padding: 12, paddingBottom: 16 }]}>
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
  const rows = useMemo(() => collectNodes(node, "tr_open").map((row) => row.children.filter((cell) => cell.token.type === "th_open" || cell.token.type === "td_open")), [node])
  const [measurements, setMeasurements] = useState<{ node: MarkdownNode; cells: Record<string, number> }>({ node, cells: {} })
  const [viewportWidth, setViewportWidth] = useState(0)
  const measuredCells = measurements.node === node ? measurements.cells : {}
  // Wait for every intrinsic cell width before constraining columns to avoid truncating later rows.
  const measured = rows.every((row, rowIndex) => row.every((_, column) => measuredCells[`${rowIndex}:${column}`] !== undefined))
  const naturalColumnWidths = measured ? Array.from({ length: Math.max(0, ...rows.map((row) => row.length)) }, (_, column) => Math.max(0, ...rows.map((_, rowIndex) => measuredCells[`${rowIndex}:${column}`] ?? 0))) : null
  const naturalWidth = naturalColumnWidths?.reduce((sum, width) => sum + width, 0) ?? 0
  // Cell measurements include their right borders; reserve the table's separate left border.
  const widthScale = naturalWidth > 0 ? Math.max(1, (viewportWidth - 1) / naturalWidth) : 1
  const columnWidths = naturalColumnWidths?.map((width) => width * widthScale)

  return (
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator style={{ ...horizontalScrollStyle, alignSelf: "stretch", maxWidth: "100%" }}
      contentContainerStyle={{ minWidth: viewportWidth }}
      onLayout={({ nativeEvent: { layout } }) => {
        if (layout.width > 0) setViewportWidth((current) => Math.abs(current - layout.width) < 0.5 ? current : layout.width)
      }}
    >
      <View style={{ alignSelf: "flex-start", borderColor: context.borderColor, borderLeftWidth: 1, borderTopWidth: 1 }}>
        {rows.map((cells, rowIndex) => (
          <View key={`row:${rowIndex}`} style={{ flexDirection: "row" }}>
            {cells.map((cell, column) => {
              const alignment = cell.token.attrGet("style")?.match(/text-align:\s*(left|center|right)/)?.[1] as "left" | "center" | "right" | undefined
              return (
                <View
                  key={`cell:${rowIndex}:${column}`}
                  onLayout={(event) => {
                    if (columnWidths) return
                    const width = event.nativeEvent.layout.width
                    if (width <= 0) return
                    setMeasurements((current) => {
                      const cells = current.node === node ? current.cells : {}
                      if (cells[`${rowIndex}:${column}`] === width) return current
                      return { node, cells: { ...cells, [`${rowIndex}:${column}`]: width } }
                    })
                  }}
                  style={{ borderBottomWidth: 1, borderColor: context.borderColor, borderRightWidth: 1, flexShrink: 0, paddingHorizontal: 8, paddingVertical: 12, width: columnWidths?.[column] }}
                >
                  <Text selectable={context.selectable} style={{ color: context.textColor, fontSize: 14, fontWeight: cell.token.type === "th_open" ? "600" : "400", lineHeight: 20, textAlign: alignment ?? "left" }}>
                    {renderNodeInlineContent(cell, { ...context, fontSize: 14, lineHeight: 20, inlineStyle: { ...context.inlineStyle, fontWeight: cell.token.type === "th_open" ? "600" : "400" } })}
                  </Text>
                </View>
              )
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function MarkdownImage({ serverUrl, token }: { serverUrl: string; token: Token }) {
  const router = useRouter()
  const { colors } = useXGUITheme()
  const { width: viewportWidth } = useWindowDimensions()
  const source = resolveMarkdownUrl(token.attrGet("src") ?? "", serverUrl)
  const alt = token.content.trim() || "图片"
  const [loaded, setLoaded] = useState<{ source: string; width: number; height: number } | null>(null)
  const [layout, setLayout] = useState<{ key: string; width: number } | null>(null)
  const naturalSize = loaded?.source === source ? loaded : null
  const layoutKey = JSON.stringify([source, viewportWidth, naturalSize?.width, naturalSize?.height])
  const frame = getMarkdownImageFrame(naturalSize ?? { width: viewportWidth, height: 160 }, layout?.key === layoutKey ? layout.width : viewportWidth)

  if (!source || !/^https?:/i.test(source)) {
    return <Text style={[styles.text, { color: colors.textPlaceholder }]}>{alt}</Text>
  }

  return (
    <Pressable accessibilityLabel={alt} accessibilityRole="button" onPress={() => router.push(buildUrlImagePreviewHref(source))}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width
        if (width > 0) setLayout((current) => current?.key === layoutKey && Math.abs(current.width - width) < 0.5 ? current : { key: layoutKey, width })
      }}
      style={{ alignSelf: "flex-start", borderRadius: 6, marginVertical: 4, maxWidth: "100%", overflow: "hidden", width: frame.width }}
    >
      <Image
        onLoad={(event) => {
          const { width, height } = event.nativeEvent.source
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            setLoaded((current) => current?.source === source && current.width === width && current.height === height ? current : { source, width, height })
          }
        }}
        resizeMode="contain"
        source={{ uri: source }}
        style={{ height: frame.height, width: "100%" }}
      />
    </Pressable>
  )
}

function getMarkdownImageFrame(size: { width: number; height: number }, availableWidth: number) {
  const scale = Math.min(1, Math.max(1, availableWidth) / size.width, 320 / size.height)
  return { width: size.width * scale, height: size.height * scale }
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
  const childColor = token.type === "link_open" ? context.linkColor : token.type === "s_open" ? context.secondaryTextColor : color
  const inlineStyle: MarkdownRenderContext["inlineStyle"] = token.type === "strong_open" ? { fontWeight: "600" }
    : token.type === "em_open" ? { fontStyle: "italic" }
      : token.type === "s_open" ? { textDecorationLine: "line-through" } : undefined
  const childContext = inlineStyle ? { ...context, inlineStyle: { ...context.inlineStyle, ...inlineStyle } } : context
  const children = node.children.map((child, index) =>
    renderInlineNode(
      child,
      `${key}:${child.token.type}:${index}`,
      childContext,
      childColor
    )
  )

  if (token.type === "text") {
    return (
      <MessageMentionText
        autoLink={false}
        content={token.content}
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
      <MarkdownInlineCode
        key={key}
        backgroundColor={context.codeBackground}
        bodyFontSize={context.fontSize}
        color={color}
        content={token.content}
        fontFamily={getMarkdownCodeFont(context.inlineStyle)}
        inlineStyle={context.inlineStyle}
        lineHeight={context.lineHeight}
        selectable={context.selectable}
      />
    )
  }
  if (token.type === "strong_open") {
    return (
      <Text key={key} style={{ color, fontWeight: "600" }}>
        {children}
      </Text>
    )
  }
  if (token.type === "em_open") {
    return (
      <Text key={key} style={{ color, fontStyle: "italic" }}>
        {children}
      </Text>
    )
  }
  if (token.type === "s_open") {
    return (
      <Text key={key} style={{ color: context.secondaryTextColor, textDecorationLine: "line-through" }}>
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
      <Text key={key} onPress={url ? () => void openMarkdownUrl(url) : undefined} style={{ color: context.linkColor }}>
        {children}
      </Text>
    )
  }
  if (token.type === "image") {
    return null
  }

  if (children.length > 0) {
    return <Text key={key} style={{ color }}>{children}</Text>
  }

  return token.content ? (
    <MessageMentionText
      autoLink={false}
      content={token.content}
      currentUserId={context.currentUserId}
      key={key}
      onMentionPress={context.onMentionPress}
      resolveMentionLabel={context.resolveMentionLabel}
    />
  ) : null
}

function MarkdownInlineCode({ backgroundColor, bodyFontSize, color, content, fontFamily, inlineStyle, lineHeight, selectable }: {
  backgroundColor: string
  bodyFontSize: number
  color: string
  content: string
  fontFamily: string
  inlineStyle: MarkdownRenderContext["inlineStyle"]
  lineHeight: number
  selectable: boolean
}) {
  const { width: viewportWidth, fontScale = 1, scale = 1 } = useWindowDimensions()
  const fontSize = Math.round(bodyFontSize * 0.92)
  const measurementKey = JSON.stringify([content, bodyFontSize, fontFamily, inlineStyle, lineHeight, viewportWidth, fontScale, scale])
  const [frame, setFrame] = useState<{ key: string; width: number; height: number } | null>(null)
  const [metrics, setMetrics] = useState<{ key: string; ascender: number; descender: number } | null>(null)
  const geometry = frame?.key === measurementKey && metrics?.key === measurementKey ? getInlineCodeGeometry(frame, metrics) : null
  const attachment = geometry ? { width: geometry.width, height: geometry.ascent } : null

  return (
    <View accessible={false} collapsable={false} pointerEvents="box-none" style={attachment ?? { maxWidth: "100%" }}>
      <Text
        key={`metrics:${measurementKey}`}
        accessible={false}
        numberOfLines={1}
        pointerEvents="none"
        style={{ fontSize: bodyFontSize, lineHeight, ...inlineStyle, opacity: 0, position: "absolute", width: bodyFontSize * 4 }}
        onTextLayout={({ nativeEvent }) => {
          const line = nativeEvent.lines[0]
          if (!line || line.ascender + line.descender <= 0) return
          setMetrics((current) => current?.key === measurementKey && current.ascender === line.ascender && current.descender === line.descender
            ? current : { key: measurementKey, ascender: line.ascender, descender: line.descender })
        }}
      >Hg</Text>
      <View
        key={`code:${measurementKey}`}
        style={{ backgroundColor, borderRadius: 4, overflow: "hidden", paddingHorizontal: 4, paddingVertical: 2, ...(geometry ? { position: "absolute", top: geometry.top, width: geometry.width } : { maxWidth: "100%" }) }}
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.width <= 0 || layout.height <= 0) return
          setFrame((current) => current?.key === measurementKey && current.width === layout.width && current.height === layout.height
            ? current : { key: measurementKey, width: layout.width, height: layout.height })
        }}
      >
        <Text selectable={selectable} style={{ color, fontSize, includeFontPadding: false, lineHeight: Math.round(fontSize * 1.2), ...inlineStyle, fontFamily, fontWeight: "400", fontStyle: "normal" }}>
          {content}
        </Text>
      </View>
    </View>
  )
}

function getInlineCodeGeometry(frame: { width: number; height: number }, metrics: { ascender: number; descender: number }) {
  // Native inline attachments end at the baseline. Reserve ascent only, then center the box in the full line.
  const height = Math.max(frame.height, metrics.ascender + metrics.descender)
  return { width: frame.width, ascent: height - metrics.descender, top: (height - frame.height) / 2 }
}

function getMarkdownCodeFont(style: MarkdownRenderContext["inlineStyle"]) {
  const semibold = style?.fontWeight === "600"
  if (style?.fontStyle === "italic") return semibold ? "JetBrainsMono-SemiBoldItalic" : "JetBrainsMono-Italic"
  return semibold ? "JetBrainsMono-SemiBold" : "JetBrainsMono"
}

function collectNodes(node: MarkdownNode, type: string): MarkdownNode[] {
  const matches = node.token.type === type ? [node] : []
  return [
    ...matches,
    ...node.children.flatMap((child) => collectNodes(child, type)),
  ]
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
