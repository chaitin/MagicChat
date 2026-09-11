import * as React from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const COLLAPSED_HEIGHTS = {
  markdown: 360,
  text: 273,
} as const

const collapsedContentMask: React.CSSProperties = {
  maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
}

export function CollapsibleMessageContent({
  children,
  enabled = true,
  variant,
}: {
  children: React.ReactNode
  enabled?: boolean
  variant: keyof typeof COLLAPSED_HEIGHTS
}) {
  const contentId = React.useId()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const maxHeight = COLLAPSED_HEIGHTS[variant]

  React.useLayoutEffect(() => {
    if (!enabled) {
      return
    }

    const content = contentRef.current
    if (!content) {
      return
    }

    const measure = () => {
      const overflowing = content.scrollHeight > maxHeight + 1
      setCanExpand(overflowing)
      if (!overflowing) {
        setExpanded(false)
      }
    }
    measure()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [enabled, maxHeight])

  if (!enabled) {
    return children
  }

  const collapsed = canExpand && !expanded

  return (
    <div
      className={cn("relative max-w-full min-w-0", collapsed && "pb-7")}
      data-slot="collapsible-message"
    >
      <div
        className={cn("relative min-w-0", !expanded && "overflow-hidden")}
        id={contentId}
        style={{
          ...(!expanded ? { maxHeight } : undefined),
          ...(collapsed ? collapsedContentMask : undefined),
        }}
      >
        <div className="min-w-0" ref={contentRef}>
          {children}
        </div>
      </div>
      {collapsed && (
        <Button
          aria-controls={contentId}
          aria-expanded="false"
          className="absolute inset-x-0 bottom-0 h-[calc(3rem+1.75rem)] w-full items-end px-2 pb-1 text-xs text-muted-foreground hover:bg-transparent dark:hover:bg-transparent"
          onClick={(event) => {
            event.stopPropagation()
            setExpanded(true)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="flex h-6 items-center justify-center gap-1">
            <ChevronDown className="size-3.5" />
            展开全文
          </span>
        </Button>
      )}
    </div>
  )
}
