import { useRouter } from "expo-router"
import MarkdownIt from "markdown-it"
import type Token from "markdown-it/lib/token.mjs"
import { memo, useMemo, type ReactNode } from "react"
import { Linking, ScrollView } from "react-native"
import {
  Image,
  Paragraph,
  Separator,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

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
      <Paragraph
        color={colors.textPrimary}
        selectable={selectable}
        size="$4"
      >
        <MessageMentionText
          content={content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
        />
      </Paragraph>
    )
  }

  const context: MarkdownRenderContext = {
    currentUserId,
    linkColor: colors.link,
    onMentionPress,
    resolveMentionLabel,
    selectable,
    serverUrl,
    textColor: colors.textPrimary,
  }

  return (
    <YStack gap="$2" maxW="100%">
      {renderBlockNodes(nodes, context)}
    </YStack>
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
      <SizableText
        color={context.textColor}
        fontWeight="700"
        key={key}
        lineHeight={23}
        size="$4"
      >
        {renderNodeInlineContent(node, context)}
      </SizableText>
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
      <YStack flex={1} gap="$2" key={key}>
        {renderBlockNodes(node.children, context)}
      </YStack>
    )
  }

  if (token.type === "blockquote_open") {
    return (
      <YStack
        bg="$backgroundPress"
        borderColor="$borderColor"
        borderLeftWidth={3}
        gap="$2"
        key={key}
        p="$2"
        pl="$3"
      >
        {renderBlockNodes(node.children, context)}
      </YStack>
    )
  }

  if (token.type === "fence" || token.type === "code_block") {
    return <MarkdownCodeBlock context={context} key={key} token={token} />
  }

  if (token.type === "hr") {
    return <Separator key={key} />
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
      <Paragraph color={context.textColor} key={key} selectable={context.selectable} size="$4">
        {renderInlineTokens(
          token.children ?? [],
          context
        )}
      </Paragraph>
    )
  }

  if (node.children.length > 0) {
    return (
      <YStack gap="$2" key={key}>
        {renderBlockNodes(node.children, context)}
      </YStack>
    )
  }

  return token.content ? (
    <Paragraph color={context.textColor} key={key} selectable={context.selectable} size="$4">
      <MessageMentionText
        content={token.content}
        currentUserId={context.currentUserId}
        onMentionPress={context.onMentionPress}
        resolveMentionLabel={context.resolveMentionLabel}
      />
    </Paragraph>
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
    <YStack gap="$2" key={key}>
      {hasText || imageTokens.length === 0 ? (
        <Paragraph color={context.textColor} lineHeight={23} selectable={context.selectable} size="$4">
          {renderInlineTokens(inlineTokens, context)}
        </Paragraph>
      ) : null}
      {imageTokens.map((token, index) => (
        <MarkdownImage
          key={`${key}:image:${token.attrGet("src") ?? index}`}
          serverUrl={context.serverUrl}
          token={token}
        />
      ))}
    </YStack>
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
    <YStack gap="$2" key={key}>
      {items.map((item, index) => (
        <XStack
          gap="$2"
          items="flex-start"
          key={`${key}:item:${index}`}
          maxW="100%"
        >
          <SizableText
            color={context.textColor}
            minW={ordered ? 22 : 10}
            size="$4"
            text="right"
          >
            {ordered ? `${start + index}.` : "•"}
          </SizableText>
          <YStack gap="$2" minW={0} shrink={1}>
            {renderBlockNodes(item.children, context)}
          </YStack>
        </XStack>
      ))}
    </YStack>
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
    <YStack
      bg="$backgroundPress"
      borderColor="$borderColor"
      borderWidth={1}
      gap="$2"
      overflow="hidden"
      rounded="$3"
    >
      {language ? (
        <SizableText color="$color10" px="$3" pt="$2" size="$4">
          {language}
        </SizableText>
      ) : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={horizontalScrollStyle}
      >
        <SizableText p="$3" selectable={context.selectable} size="$4" style={{ fontFamily: "monospace" }}>
          {token.content.replace(/\n$/, "")}
        </SizableText>
      </ScrollView>
    </YStack>
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
      <YStack borderColor="$borderColor" borderTopWidth={1} minW={280}>
        {rows.map((row, rowIndex) => {
          const cells = row.children.filter(
            (child) =>
              child.token.type === "th_open" || child.token.type === "td_open"
          )

          return (
            <XStack key={`row:${rowIndex}`}>
              {cells.map((cell, cellIndex) => (
                <YStack
                  bg={cell.token.type === "th_open" ? "$backgroundPress" : undefined}
                  borderBottomWidth={1}
                  borderColor="$borderColor"
                  borderLeftWidth={cellIndex === 0 ? 1 : 0}
                  borderRightWidth={1}
                  key={`cell:${rowIndex}:${cellIndex}`}
                  p="$2"
                  width={140}
                >
                  <SizableText
                    fontWeight={cell.token.type === "th_open" ? "600" : "400"}
                    size="$4"
                  >
                    {renderNodeInlineContent(
                      cell,
                      context
                    )}
                  </SizableText>
                </YStack>
              ))}
            </XStack>
          )
        })}
      </YStack>
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
      <Paragraph color={colors.textPlaceholder} size="$4">
        {alt}
      </Paragraph>
    )
  }

  return (
    <Image
      accessibilityLabel={alt}
      height={160}
      objectFit="contain"
      onPress={() => router.push(buildUrlImagePreviewHref(source))}
      rounded="$3"
      src={source}
      width={220}
    />
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
      <SizableText
        color="$color10"
        key={key}
        size="$4"
        style={{ fontFamily: "monospace" }}
      >
        {token.content}
      </SizableText>
    )
  }
  if (token.type === "strong_open") {
    return (
      <SizableText color={color} fontWeight="700" key={key} size="$4">
        {children}
      </SizableText>
    )
  }
  if (token.type === "em_open") {
    return (
      <SizableText color={color} fontStyle="italic" key={key} size="$4">
        {children}
      </SizableText>
    )
  }
  if (token.type === "s_open") {
    return (
      <SizableText
        color={color}
        key={key}
        size="$4"
        textDecorationLine="line-through"
      >
        {children}
      </SizableText>
    )
  }
  if (token.type === "link_open") {
    const url = resolveMarkdownUrl(
      token.attrGet("href") ?? "",
      context.serverUrl
    )
    return (
      <SizableText
        color={context.linkColor}
        key={key}
        onPress={url ? () => void openMarkdownUrl(url) : undefined}
        size="$4"
        textDecorationLine="underline"
      >
        {children}
      </SizableText>
    )
  }
  if (token.type === "image") {
    return null
  }

  if (children.length > 0) {
    return <SizableText color={color} key={key} size="$4">{children}</SizableText>
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

async function openMarkdownUrl(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    // Invalid or unsupported links stay inert inside the message.
  }
}
