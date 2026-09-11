import * as React from "react"
import katex from "katex"
import ReactMarkdown from "react-markdown"
import remarkFlexibleMarkers from "remark-flexible-markers"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkSupersub from "remark-supersub"
import "katex/dist/katex.min.css"

import {
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { AppProfilePopover } from "@/components/app-profile-popover"
import { MarkdownCodeBlock } from "@/components/markdown-code-block"
import { MessageInlineLink } from "@/components/message-inline-link"
import { UserProfilePopover } from "@/components/user-profile-popover"
import { Checkbox } from "@/components/ui/checkbox"

const allowedMarkdownElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "mark",
  "mention",
  "ol",
  "p",
  "pre",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]

type MarkdownAstNode = {
  children?: MarkdownAstNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
  type: string
  value?: string
}

type MarkdownElementNode = {
  properties?: Record<string, unknown>
}

type MarkdownMentionProps = {
  children?: React.ReactNode
  node?: MarkdownElementNode
}

type ReactMarkdownProps = React.ComponentProps<typeof ReactMarkdown>

const fallbackMentionLabelResolver: MentionLabelResolver = () => undefined
const maxMarkdownMathLength = 10_000

type MarkdownRendererProps = {
  content: string
  currentUserId?: string
  mentionLabelResolver?: MentionLabelResolver
  variant?: "document" | "message"
}

export const MessageMarkdown = React.memo(function MessageMarkdown(
  props: Omit<MarkdownRendererProps, "variant">
) {
  return <MarkdownRenderer {...props} variant="message" />
})

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  currentUserId,
  mentionLabelResolver = fallbackMentionLabelResolver,
  variant = "document",
}: MarkdownRendererProps) {
  const remarkPlugins = React.useMemo<ReactMarkdownProps["remarkPlugins"]>(
    () => [
      [remarkGfm, { singleTilde: false }],
      remarkMath,
      remarkSupersub,
      remarkFlexibleMarkers,
      createRemarkMentionPlugin(mentionLabelResolver),
    ],
    [mentionLabelResolver]
  )
  const components = React.useMemo(
    () => createMarkdownComponents(currentUserId, variant),
    [currentUserId, variant]
  )

  return (
    <div
      className={cn(
        "max-w-full space-y-4",
        variant === "message" ? "break-all" : "break-words"
      )}
    >
      <ReactMarkdown
        allowedElements={allowedMarkdownElements}
        components={components}
        remarkPlugins={remarkPlugins}
        skipHtml
        unwrapDisallowed
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

function createMarkdownComponents(
  currentUserId: string | undefined,
  variant: "document" | "message"
): ReactMarkdownProps["components"] {
  return {
    a: ({ children, href }) =>
      href ? (
        variant === "message" ? (
          <MessageInlineLink href={href}>{children}</MessageInlineLink>
        ) : (
          <a
            className="text-(--weui-link) underline-offset-2 hover:underline"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {children}
          </a>
        )
      ) : (
        <span>{children}</span>
      ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-border bg-foreground/5 py-2 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children, className }) => {
      const mathMode = getMarkdownMathMode(className)

      return mathMode === "inline" ? (
        <MarkdownMath formula={getMarkdownCodeText(children)} mode="inline" />
      ) : (
        <code
          className={cn(
            "rounded bg-foreground/8 px-1 py-0.5 font-mono! text-[0.92em]",
            className
          )}
        >
          {children}
        </code>
      )
    },
    del: ({ children }) => (
      <del className="text-muted-foreground">{children}</del>
    ),
    h1: ({ children }) => (
      <h1 className="text-2xl leading-snug font-bold">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl leading-snug font-bold">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg leading-snug font-bold">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-base leading-snug font-bold">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-sm leading-snug font-bold">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-sm leading-snug font-semibold text-foreground/80">
        {children}
      </h6>
    ),
    hr: () => <hr className="h-px border-0 bg-foreground/20" />,
    img: ({ alt, src }) => {
      const imageSource = getMarkdownImageSource(src)

      return imageSource ? (
        <img
          alt={alt ?? ""}
          className={cn(
            "my-1 block h-auto max-w-full rounded-md object-contain",
            variant === "message" && "max-h-80"
          )}
          decoding="async"
          loading="lazy"
          src={imageSource}
        />
      ) : alt ? (
        <span className="text-muted-foreground">{alt}</span>
      ) : null
    },
    input: ({ checked, type }) =>
      type === "checkbox" ? (
        <Checkbox
          aria-label={checked ? "已完成" : "未完成"}
          checked={Boolean(checked)}
          className="mt-0.5 shrink-0 disabled:opacity-100"
          disabled
        />
      ) : null,
    li: ({ children, className }) => {
      const taskItem = className?.includes("task-list-item")

      return (
        <li
          className={cn(
            taskItem ? "flex items-start gap-2 pl-0" : "pl-1",
            className
          )}
        >
          {children}
        </li>
      )
    },
    mark: ({ children }) => (
      <mark className="rounded-sm bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-800/60">
        {children}
      </mark>
    ),
    mention: ({ children, node }: MarkdownMentionProps) => (
      <MarkdownMention currentUserId={currentUserId} node={node}>
        {children}
      </MarkdownMention>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal space-y-1 pl-5">{children}</ol>
    ),
    p: ({ children }) => <p>{children}</p>,
    pre: ({ children }) => {
      const codeElement = React.Children.toArray(children).find(
        React.isValidElement<{
          children?: React.ReactNode
          className?: string
        }>
      )
      const code = getMarkdownCodeText(codeElement?.props.children)
      const mathMode = getMarkdownMathMode(codeElement?.props.className)

      if (mathMode === "display") {
        return <MarkdownMath formula={code} mode="display" />
      }

      const language = getMarkdownCodeLanguage(codeElement?.props.className)
      return <MarkdownCodeBlock code={code} language={language} />
    },
    table: ({ children }) => (
      <div className="max-w-full overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-sm">
          {children}
        </table>
      </div>
    ),
    td: ({ children, style }) => (
      <td className="border border-border px-2 py-3 align-top" style={style}>
        {children}
      </td>
    ),
    th: ({ children, style }) => (
      <th
        className="border border-border px-2 py-3 text-left font-semibold"
        style={style}
      >
        {children}
      </th>
    ),
    tr: ({ children }) => <tr>{children}</tr>,
    sub: ({ children }) => <sub>{children}</sub>,
    sup: ({ children }) => <sup>{children}</sup>,
    ul: ({ children, className }) => {
      const taskList = className?.includes("contains-task-list")

      return (
        <ul
          className={cn(
            "space-y-1",
            taskList ? "list-none pl-0" : "list-disc pl-5",
            className
          )}
        >
          {children}
        </ul>
      )
    },
  } as ReactMarkdownProps["components"]
}

function MarkdownMath({
  formula,
  mode,
}: {
  formula: string
  mode: "display" | "inline"
}) {
  const normalizedFormula = formula.trim()
  const html = React.useMemo(() => {
    if (
      normalizedFormula.length === 0 ||
      normalizedFormula.length > maxMarkdownMathLength
    ) {
      return null
    }

    try {
      return katex.renderToString(normalizedFormula, {
        displayMode: mode === "display",
        output: "htmlAndMathml",
        strict: "warn",
        throwOnError: true,
        trust: false,
      })
    } catch {
      return null
    }
  }, [mode, normalizedFormula])

  if (!html) {
    return mode === "display" ? (
      <pre
        className="my-2 max-w-full overflow-x-auto rounded bg-foreground/8 p-2"
        data-math-error
        title="LaTeX 公式无法解析"
      >
        <code className="font-mono! text-[0.92em]">{normalizedFormula}</code>
      </pre>
    ) : (
      <code
        className="rounded bg-foreground/8 px-1 py-0.5 font-mono! text-[0.92em]"
        data-math-error
        title="LaTeX 公式无法解析"
      >
        {normalizedFormula}
      </code>
    )
  }

  return mode === "display" ? (
    <div
      className="my-2 max-w-full [scrollbar-width:none] overflow-x-auto overflow-y-hidden py-1 text-center [&::-webkit-scrollbar]:hidden"
      data-slot="markdown-math-display"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span
      className="inline-block max-w-full align-middle"
      data-slot="markdown-math-inline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function getMarkdownMathMode(className: string | undefined) {
  if (className?.split(/\s+/).includes("math-inline")) {
    return "inline" as const
  }
  if (className?.split(/\s+/).includes("math-display")) {
    return "display" as const
  }
  return null
}

function getMarkdownCodeLanguage(className: string | undefined) {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase() ?? ""
}

function getMarkdownCodeText(children: React.ReactNode) {
  return React.Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("")
    .replace(/\n$/, "")
}

function getMarkdownImageSource(src: string | Blob | undefined) {
  if (typeof src !== "string") {
    return ""
  }

  const value = src.trim()
  if (!/^https?:\/\//i.test(value)) {
    return ""
  }

  try {
    const url = new URL(value)

    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname
      ? url.href
      : ""
  } catch {
    return ""
  }
}

function MarkdownMention({
  children,
  currentUserId,
  node,
}: MarkdownMentionProps & {
  currentUserId?: string
}) {
  const mentionId = getMarkdownNodeProperty(node, "data-mention-id")
  const mentionType = getMarkdownNodeProperty(node, "data-mention-type")
  const isCurrentUserMention =
    mentionType === "all" ||
    (mentionType === "user" && isSameUserId(mentionId, currentUserId))
  const content = (
    <span
      className={getMentionTextClassName(isCurrentUserMention)}
      data-mention-id={mentionId}
      data-mention-type={mentionType}
    >
      {children}
    </span>
  )

  if (mentionType === "user" && mentionId) {
    return (
      <UserProfilePopover triggerClassName="align-baseline" userId={mentionId}>
        {content}
      </UserProfilePopover>
    )
  }

  if (mentionType === "app" && mentionId) {
    return (
      <AppProfilePopover
        appId={mentionId}
        fallbackProfile={{
          avatar: "",
          description: "",
          id: mentionId,
          name: getMentionFallbackName(children),
          online: false,
        }}
        triggerClassName="align-baseline"
      >
        {content}
      </AppProfilePopover>
    )
  }

  return content
}

function getMentionTextClassName(isCurrentUserMention: boolean) {
  return isCurrentUserMention
    ? "mx-0.5 font-medium text-amber-600 hover:text-amber-700"
    : "mx-0.5 font-medium text-(--weui-link)"
}

function isSameUserId(userId: string | undefined, currentUserId?: string) {
  return (
    typeof userId === "string" &&
    typeof currentUserId === "string" &&
    userId.toLowerCase() === currentUserId.toLowerCase()
  )
}

function getMentionFallbackName(children: React.ReactNode) {
  const text = React.Children.toArray(children).join("").trim()

  return text.replace(/^@/, "") || "应用"
}

function createRemarkMentionPlugin(mentionLabelResolver: MentionLabelResolver) {
  return function remarkMentionPlugin() {
    return function transformMentionTokens(tree: MarkdownAstNode) {
      replaceMentionTextNodes(tree, mentionLabelResolver)
    }
  }
}

function replaceMentionTextNodes(
  node: MarkdownAstNode,
  mentionLabelResolver: MentionLabelResolver
) {
  if (!node.children) {
    return
  }

  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && typeof child.value === "string") {
      return createMentionNodes(child.value, mentionLabelResolver)
    }

    if (child.type !== "inlineCode" && child.type !== "code") {
      replaceMentionTextNodes(child, mentionLabelResolver)
    }

    return [child]
  })
}

function createMentionNodes(
  value: string,
  mentionLabelResolver: MentionLabelResolver
) {
  const parts = parseMentionTemplate(value, mentionLabelResolver)

  if (!parts.some((part) => part.type === "mention")) {
    return [{ type: "text", value }]
  }

  return parts.map((part): MarkdownAstNode => {
    if (part.type === "text") {
      return {
        type: "text",
        value: part.text,
      }
    }

    return {
      children: [
        {
          type: "text",
          value: part.label,
        },
      ],
      data: {
        hName: "mention",
        hProperties: {
          "data-mention-id": part.id,
          "data-mention-type": part.targetType,
        },
      },
      type: "mention",
      value: part.label,
    }
  })
}

function getMarkdownNodeProperty(
  node: MarkdownElementNode | undefined,
  name: string
) {
  const value = node?.properties?.[name]
  return typeof value === "string" ? value : undefined
}
