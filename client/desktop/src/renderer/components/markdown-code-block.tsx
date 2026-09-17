import { useEffect, useState } from "react"
import type { BundledLanguage } from "shiki"
import { ScrollArea } from "@/components/ui/scroll-area"

const cache = new Map<string, Promise<string | null>>()
const cacheLimit = 200
const maximumCodeLength = 100_000

export function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  const key = `${language}\0${code}`
  const [result, setResult] = useState<{ key: string; html: string } | null>(null)

  useEffect(() => {
    if (!language || code.length > maximumCodeLength) return
    let active = true
    highlightCode(key, code, language).then((html) => {
      if (active && html) setResult({ key, html })
    })
    return () => {
      active = false
    }
  }, [code, key, language])

  if (result?.key !== key) {
    return (
      <ScrollArea
        type="hover"
        scrollHideDelay={200}
        scrollbarOrientation="horizontal"
        className="max-w-full overflow-hidden rounded bg-foreground/8"
      >
        <pre className="w-max min-w-full p-3 pb-4 font-mono! text-[0.92em]">
          <code className="font-mono!">{code}</code>
        </pre>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea
      type="hover"
      scrollHideDelay={200}
      scrollbarOrientation="horizontal"
      className="max-w-full overflow-hidden rounded bg-foreground/8"
    >
      <div
        className="markdown-code-highlight w-max min-w-full pb-1 font-mono! text-[0.92em]"
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    </ScrollArea>
  )
}

function highlightCode(key: string, code: string, language: string) {
  const existing = cache.get(key)
  if (existing) return existing
  const result = import("shiki")
    .then(({ codeToHtml }) =>
      codeToHtml(code, {
        lang: language as BundledLanguage,
        themes: { dark: "github-dark", light: "github-light" },
      }),
    )
    .catch(() => null)
  if (cache.size >= cacheLimit) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, result)
  return result
}
