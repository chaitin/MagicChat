import MarkdownIt from "markdown-it"
import type Token from "markdown-it/lib/token.mjs"
import { useMemo, type ReactNode } from "react"
import { Linking, ScrollView } from "react-native"
import {
  Image,
  Paragraph,
  Separator,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import {
  formatMentionTemplateText,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"

type MarkdownNode = {
  children: MarkdownNode[]
  token: Token
}

const markdownParser = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
})

export function MarkdownMessage({
  content,
  resolveMentionLabel,
  serverUrl,
}: {
  content: string
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
}) {
  const nodes = useMemo(() => {
    try {
      return buildTokenTree(markdownParser.parse(content, {}))
    } catch {
      return []
    }
  }, [content])

  if (nodes.length === 0) {
    return (
      <Paragraph selectable>
        {formatMentionTemplateText(content, resolveMentionLabel)}
      </Paragraph>
    )
  }

  return (
    <YStack gap="$3" maxW="100%">
      {renderBlockNodes(nodes, resolveMentionLabel, serverUrl)}
    </YStack>
  )
}

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
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
) {
  return nodes.map((node, index) =>
    renderBlockNode(
      node,
      `${node.token.type}:${node.token.map?.[0] ?? index}:${index}`,
      resolveMentionLabel,
      serverUrl
    )
  )
}

function renderBlockNode(
  node: MarkdownNode,
  key: string,
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
): ReactNode {
  const { token } = node

  if (token.type === "paragraph_open") {
    return renderParagraph(node, key, resolveMentionLabel, serverUrl)
  }

  if (token.type === "heading_open") {
    const level = Number(token.tag.slice(1)) || 3
    return (
      <SizableText
        fontWeight="700"
        key={key}
        lineHeight={getHeadingLineHeight(level)}
        size={getHeadingSize(level)}
      >
        {renderNodeInlineContent(node, resolveMentionLabel, serverUrl)}
      </SizableText>
    )
  }

  if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
    return renderList(
      node,
      key,
      token.type === "ordered_list_open",
      resolveMentionLabel,
      serverUrl
    )
  }

  if (token.type === "list_item_open") {
    return (
      <YStack flex={1} gap="$2" key={key}>
        {renderBlockNodes(node.children, resolveMentionLabel, serverUrl)}
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
        {renderBlockNodes(node.children, resolveMentionLabel, serverUrl)}
      </YStack>
    )
  }

  if (token.type === "fence" || token.type === "code_block") {
    return <MarkdownCodeBlock key={key} token={token} />
  }

  if (token.type === "hr") {
    return <Separator key={key} />
  }

  if (token.type === "table_open") {
    return (
      <MarkdownTable
        key={key}
        node={node}
        resolveMentionLabel={resolveMentionLabel}
        serverUrl={serverUrl}
      />
    )
  }

  if (token.type === "inline") {
    return (
      <Paragraph key={key} selectable>
        {renderInlineTokens(
          token.children ?? [],
          resolveMentionLabel,
          serverUrl
        )}
      </Paragraph>
    )
  }

  if (node.children.length > 0) {
    return (
      <YStack gap="$2" key={key}>
        {renderBlockNodes(node.children, resolveMentionLabel, serverUrl)}
      </YStack>
    )
  }

  return token.content ? (
    <Paragraph key={key} selectable>
      {formatMentionTemplateText(token.content, resolveMentionLabel)}
    </Paragraph>
  ) : null
}

function renderParagraph(
  node: MarkdownNode,
  key: string,
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
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
        <Paragraph lineHeight={22} selectable>
          {renderInlineTokens(inlineTokens, resolveMentionLabel, serverUrl)}
        </Paragraph>
      ) : null}
      {imageTokens.map((token, index) => (
        <MarkdownImage
          key={`${key}:image:${token.attrGet("src") ?? index}`}
          serverUrl={serverUrl}
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
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
) {
  const items = node.children.filter(
    (child) => child.token.type === "list_item_open"
  )
  const start = Number(node.token.attrGet("start") ?? "1") || 1

  return (
    <YStack gap="$2" key={key}>
      {items.map((item, index) => (
        <XStack gap="$2" items="flex-start" key={`${key}:item:${index}`}>
          <SizableText minW={ordered ? 22 : 10} text="right">
            {ordered ? `${start + index}.` : "•"}
          </SizableText>
          <YStack flex={1} gap="$2">
            {renderBlockNodes(item.children, resolveMentionLabel, serverUrl)}
          </YStack>
        </XStack>
      ))}
    </YStack>
  )
}

function MarkdownCodeBlock({ token }: { token: Token }) {
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
        <SizableText color="$color10" px="$3" pt="$2" size="$1">
          {language}
        </SizableText>
      ) : null}
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <SizableText p="$3" selectable size="$2" style={{ fontFamily: "monospace" }}>
          {token.content.replace(/\n$/, "")}
        </SizableText>
      </ScrollView>
    </YStack>
  )
}

function MarkdownTable({
  node,
  resolveMentionLabel,
  serverUrl,
}: {
  node: MarkdownNode
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
}) {
  const rows = collectNodes(node, "tr_open")

  return (
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
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
                    size="$2"
                  >
                    {renderNodeInlineContent(
                      cell,
                      resolveMentionLabel,
                      serverUrl
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
  const source = resolveMarkdownUrl(token.attrGet("src") ?? "", serverUrl)
  const alt = token.content.trim() || "图片"

  if (!source || !/^https?:/i.test(source)) {
    return <Paragraph color="$color10">{alt}</Paragraph>
  }

  return (
    <Image
      accessibilityLabel={alt}
      height={160}
      objectFit="contain"
      onPress={() => void openMarkdownUrl(source)}
      rounded="$3"
      src={source}
      width={220}
    />
  )
}

function renderNodeInlineContent(
  node: MarkdownNode,
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
) {
  const inlineToken = node.children.find((child) => child.token.type === "inline")
    ?.token

  return renderInlineTokens(
    inlineToken?.children ?? [],
    resolveMentionLabel,
    serverUrl
  )
}

function renderInlineTokens(
  tokens: Token[],
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
) {
  return buildTokenTree(tokens).map((node, index) =>
    renderInlineNode(
      node,
      `${node.token.type}:${index}`,
      resolveMentionLabel,
      serverUrl
    )
  )
}

function renderInlineNode(
  node: MarkdownNode,
  key: string,
  resolveMentionLabel: MessageMentionLabelResolver,
  serverUrl: string
): ReactNode {
  const { token } = node
  const children = node.children.map((child, index) =>
    renderInlineNode(
      child,
      `${key}:${child.token.type}:${index}`,
      resolveMentionLabel,
      serverUrl
    )
  )

  if (token.type === "text") {
    return (
      <SizableText key={key}>
        {formatTaskMarker(
          formatMentionTemplateText(token.content, resolveMentionLabel)
        )}
      </SizableText>
    )
  }
  if (token.type === "softbreak" || token.type === "hardbreak") {
    return "\n"
  }
  if (token.type === "code_inline") {
    return (
      <SizableText
        bg="$backgroundPress"
        key={key}
        px="$1"
        rounded="$1"
        style={{ fontFamily: "monospace" }}
      >
        {token.content}
      </SizableText>
    )
  }
  if (token.type === "strong_open") {
    return (
      <SizableText fontWeight="700" key={key}>
        {children}
      </SizableText>
    )
  }
  if (token.type === "em_open") {
    return (
      <SizableText fontStyle="italic" key={key}>
        {children}
      </SizableText>
    )
  }
  if (token.type === "s_open") {
    return (
      <SizableText key={key} textDecorationLine="line-through">
        {children}
      </SizableText>
    )
  }
  if (token.type === "link_open") {
    const url = resolveMarkdownUrl(token.attrGet("href") ?? "", serverUrl)
    return (
      <SizableText
        color="$teal10"
        key={key}
        onPress={url ? () => void openMarkdownUrl(url) : undefined}
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
    return <SizableText key={key}>{children}</SizableText>
  }

  return token.content ? (
    <SizableText key={key}>
      {formatMentionTemplateText(token.content, resolveMentionLabel)}
    </SizableText>
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

function getHeadingSize(level: number): "$3" | "$4" | "$5" | "$6" {
  if (level === 1) return "$6"
  if (level === 2) return "$5"
  if (level === 3) return "$4"
  return "$3"
}

function getHeadingLineHeight(level: number) {
  if (level === 1) return 30
  if (level === 2) return 26
  return 22
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
