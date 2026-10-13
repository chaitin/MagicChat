import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

const DEFAULT_ROW_HEIGHT = 48
const OVERSCAN = 8

export function VirtualizedList<T>({
  items,
  getKey,
  renderItem,
  empty,
  loading = false,
  ariaLabel,
  resetKey = "",
  rowHeight = DEFAULT_ROW_HEIGHT,
}: {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  empty: ReactNode
  loading?: boolean
  ariaLabel: string
  resetKey?: string
  rowHeight?: number
}) {
  const [range, setRange] = useState({ start: 0, end: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)

  function updateRange() {
    const viewport = viewportRef.current
    if (!viewport) return
    const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - OVERSCAN)
    const count = Math.ceil(viewport.clientHeight / rowHeight) + OVERSCAN * 2
    setRange({ start: first, end: Math.min(items.length, first + count) })
  }

  useLayoutEffect(() => {
    if (viewportRef.current && resetKey) viewportRef.current.scrollTop = 0
    updateRange()
  }, [items.length, resetKey, rowHeight])

  function onScroll() {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      updateRange()
    })
  }

  const visible = items.slice(range.start, range.end || Math.min(items.length, OVERSCAN * 2))
  return (
    <ScrollArea
      className="h-64 rounded-md border"
      viewportClassName="[&>div]:block! [&>div]:w-full!"
      viewportRef={viewportRef}
      onViewportScroll={onScroll}
      aria-label={ariaLabel}
    >
      {loading ? (
        <div className="px-3 py-10 text-center text-sm text-muted-foreground">加载中…</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-10 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="relative w-full" style={{ height: items.length * rowHeight }}>
          {visible.map((item, index) => {
            const actualIndex = range.start + index
            return (
              <div
                key={getKey(item)}
                className="absolute inset-x-0"
                style={{ height: rowHeight, top: actualIndex * rowHeight }}
              >
                {renderItem(item)}
              </div>
            )
          })}
        </div>
      )}
    </ScrollArea>
  )
}
