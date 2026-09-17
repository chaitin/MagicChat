import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const collapsedHeights = {
  markdown: 240,
  text: 240,
} as const

const collapsedContentMask = {
  maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
  WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)",
}

export function CollapsibleMessageContent({
  children,
  variant,
}: {
  children: ReactNode
  variant: keyof typeof collapsedHeights
}) {
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const maxHeight = collapsedHeights[variant]

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const measure = () => {
      const overflowing = content.scrollHeight > maxHeight + 1
      setCanExpand(overflowing)
      if (!overflowing) setExpanded(false)
    }
    measure()
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [maxHeight])

  const collapsed = canExpand && !expanded
  return (
    <div className={cn("relative max-w-full min-w-0", collapsed && "pb-7")}>
      <div
        id={contentId}
        className={cn("relative min-w-0", !expanded && "overflow-hidden")}
        style={{
          ...(!expanded ? { maxHeight } : undefined),
          ...(collapsed ? collapsedContentMask : undefined),
        }}
      >
        <div ref={contentRef} className="min-w-0">
          {children}
        </div>
      </div>
      {collapsed && (
        <Button
          aria-controls={contentId}
          aria-expanded="false"
          className="absolute inset-x-0 bottom-0 h-[calc(3rem+1.75rem)] w-full items-end rounded-none px-2 pb-1 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation()
            setExpanded(true)
          }}
        >
          <span className="flex h-6 items-center justify-center gap-1">
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" aria-hidden />
            展开全文
          </span>
        </Button>
      )}
    </div>
  )
}
