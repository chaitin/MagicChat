import * as React from "react"
import type { BundledLanguage } from "shiki"

const HIGHLIGHT_CACHE_LIMIT = 200
const MAX_HIGHLIGHT_CODE_LENGTH = 100_000

type HighlightResult = {
  html: string
  key: string
}

const highlightCache = new Map<string, Promise<string | null>>()

export function MarkdownCodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  const cacheKey = `${language}\u0000${code}`
  const [result, setResult] = React.useState<HighlightResult | null>(null)

  React.useEffect(() => {
    if (!language || code.length > MAX_HIGHLIGHT_CODE_LENGTH) {
      return undefined
    }

    let active = true

    highlightCode(cacheKey, code, language).then((html) => {
      if (active && html) {
        setResult({ html, key: cacheKey })
      }
    })

    return () => {
      active = false
    }
  }, [cacheKey, code, language])

  if (result?.key !== cacheKey) {
    return <PlainMarkdownCodeBlock code={code} />
  }

  return (
    <div
      className="markdown-code-highlight max-w-full overflow-x-auto rounded bg-foreground/8 font-mono! text-[0.92em]"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  )
}

function PlainMarkdownCodeBlock({ code }: { code: string }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded bg-foreground/8 p-3 font-mono! text-[0.92em]">
      <code className="font-mono!">{code}</code>
    </pre>
  )
}

function highlightCode(cacheKey: string, code: string, language: string) {
  const cached = highlightCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const highlighted = import("shiki")
    .then(({ codeToHtml }) =>
      codeToHtml(code, {
        lang: language as BundledLanguage,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      })
    )
    .catch(() => null)

  if (highlightCache.size >= HIGHLIGHT_CACHE_LIMIT) {
    const oldestKey = highlightCache.keys().next().value
    if (oldestKey) {
      highlightCache.delete(oldestKey)
    }
  }
  highlightCache.set(cacheKey, highlighted)

  return highlighted
}
