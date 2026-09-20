import { Children, isValidElement, useMemo, type ReactNode } from "react"
import katex from "katex"
import ReactMarkdown from "react-markdown"
import remarkFlexibleMarkers from "remark-flexible-markers"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkSupersub from "remark-supersub"
import "katex/dist/katex.min.css"
import { MarkdownCodeBlock } from "@/components/markdown-code-block"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { Checkbox } from "@/components/ui/checkbox"
import {
  createRemarkMentionPlugin,
  mentionClassName,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { cn } from "@/lib/utils"

const allowedElements = [
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
const maximumMathLength = 10_000

type MarkdownComponents = React.ComponentProps<typeof ReactMarkdown>["components"]

export function MessageMarkdown({
  content,
  currentUserId,
  mentionLabelResolver,
}: {
  content: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  const components = useMemo(() => createComponents(currentUserId), [currentUserId])
  const plugins = useMemo<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>(
    () => [
      [remarkGfm, { singleTilde: false }],
      remarkMath,
      remarkSupersub,
      remarkFlexibleMarkers,
      createRemarkMentionPlugin(mentionLabelResolver),
    ],
    [mentionLabelResolver],
  )
  return (
    <div className="max-w-full space-y-4 break-all">
      <ReactMarkdown
        allowedElements={allowedElements}
        components={components}
        remarkPlugins={plugins}
        skipHtml
        unwrapDisallowed
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function createComponents(currentUserId: string): MarkdownComponents {
  return {
    a: ({ children, href }) =>
      href ? (
        <a
          className="text-xgui-link underline-offset-2 hover:underline"
          href={safeLink(href)}
          rel="noreferrer"
          target="_blank"
        >
          {children}
        </a>
      ) : (
        <span>{children}</span>
      ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-border bg-foreground/5 py-2 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children, className }) =>
      mathMode(className) === "inline" ? (
        <MarkdownMath formula={codeText(children)} mode="inline" />
      ) : (
        <code
          className={cn("rounded bg-foreground/8 px-1 py-0.5 font-mono! text-[0.92em]", className)}
        >
          {children}
        </code>
      ),
    del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
    h1: ({ children }) => <h1 className="text-2xl leading-snug font-bold">{children}</h1>,
    h2: ({ children }) => <h2 className="text-xl leading-snug font-bold">{children}</h2>,
    h3: ({ children }) => <h3 className="text-lg leading-snug font-bold">{children}</h3>,
    h4: ({ children }) => <h4 className="text-base leading-snug font-bold">{children}</h4>,
    h5: ({ children }) => <h5 className="text-sm leading-snug font-bold">{children}</h5>,
    h6: ({ children }) => (
      <h6 className="text-sm leading-snug font-semibold text-foreground/80">{children}</h6>
    ),
    hr: () => <hr className="h-px border-0 bg-foreground/20" />,
    img: ({ alt, src }) => {
      const source = imageSource(src)
      return source ? (
        <img
          alt={alt ?? ""}
          className="my-1 block h-auto max-h-80 max-w-full rounded-md object-contain"
          decoding="async"
          loading="lazy"
          src={source}
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
      const task = className?.includes("task-list-item")
      return (
        <li className={cn(task ? "flex items-start gap-2 pl-0" : "pl-1", className)}>{children}</li>
      )
    },
    mark: ({ children }) => (
      <mark className="rounded-sm bg-amber-200/80 px-0.5 text-inherit dark:bg-amber-800/60">
        {children}
      </mark>
    ),
    mention: ({ children, node }: MentionProps) => {
      const id = nodeProperty(node, "data-mention-id")
      const type = nodeProperty(node, "data-mention-type") as "user" | "app" | "all"
      const label = <span className={mentionClassName(type, id, currentUserId)}>{children}</span>
      return id && (type === "user" || type === "app") ? (
        <ContactProfilePopover
          type={type}
          id={id}
          fallbackName={codeText(children).replace(/^@/, "")}
          triggerClassName="align-baseline"
        >
          {label}
        </ContactProfilePopover>
      ) : (
        label
      )
    },
    ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
    p: ({ children }) => <p>{children}</p>,
    pre: ({ children }) => {
      const element = Children.toArray(children).find(
        isValidElement<{ children?: ReactNode; className?: string }>,
      )
      const code = codeText(element?.props.children)
      if (mathMode(element?.props.className) === "display") {
        return <MarkdownMath formula={code} mode="display" />
      }
      return <MarkdownCodeBlock code={code} language={codeLanguage(element?.props.className)} />
    },
    table: ({ children }) => (
      <div className="max-w-full overflow-x-auto">
        <table className="w-max min-w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    td: ({ children, style }) => (
      <td className="border border-border px-2 py-3 align-top" style={style}>
        {children}
      </td>
    ),
    th: ({ children, style }) => (
      <th className="border border-border px-2 py-3 text-left font-semibold" style={style}>
        {children}
      </th>
    ),
    tr: ({ children }) => <tr>{children}</tr>,
    sub: ({ children }) => <sub>{children}</sub>,
    sup: ({ children }) => <sup>{children}</sup>,
    ul: ({ children, className }) => {
      const task = className?.includes("contains-task-list")
      return (
        <ul className={cn("space-y-1", task ? "list-none pl-0" : "list-disc pl-5", className)}>
          {children}
        </ul>
      )
    },
  } as MarkdownComponents
}

type MentionProps = {
  children?: ReactNode
  node?: { properties?: Record<string, unknown> }
}

function nodeProperty(node: MentionProps["node"], name: string) {
  const value = node?.properties?.[name]
  return typeof value === "string" ? value : ""
}

function MarkdownMath({ formula, mode }: { formula: string; mode: "display" | "inline" }) {
  const normalized = formula.trim()
  const html = useMemo(() => {
    if (!normalized || normalized.length > maximumMathLength) return null
    try {
      return katex.renderToString(normalized, {
        displayMode: mode === "display",
        output: "htmlAndMathml",
        strict: "warn",
        throwOnError: true,
        trust: false,
      })
    } catch {
      return null
    }
  }, [mode, normalized])
  if (!html) {
    return mode === "display" ? (
      <pre
        className="my-2 max-w-full overflow-x-auto rounded bg-foreground/8 p-2"
        title="LaTeX 公式无法解析"
      >
        <code className="font-mono! text-[0.92em]">{normalized}</code>
      </pre>
    ) : (
      <code
        className="rounded bg-foreground/8 px-1 py-0.5 font-mono! text-[0.92em]"
        title="LaTeX 公式无法解析"
      >
        {normalized}
      </code>
    )
  }
  return mode === "display" ? (
    <div
      className="my-2 max-w-full overflow-x-auto overflow-y-hidden py-1 text-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span
      className="inline-block max-w-full align-middle"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function mathMode(className?: string) {
  if (className?.split(/\s+/).includes("math-inline")) return "inline" as const
  if (className?.split(/\s+/).includes("math-display")) return "display" as const
  return null
}

function codeLanguage(className?: string) {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase() ?? ""
}

function codeText(children: ReactNode) {
  return Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("")
    .replace(/\n$/, "")
}

function imageSource(source: string | Blob | undefined) {
  if (typeof source !== "string") return ""
  try {
    const url = new URL(source.trim())
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : ""
  } catch {
    return ""
  }
}

function safeLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}
