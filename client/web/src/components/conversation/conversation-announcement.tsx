import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ConversationAnnouncement({
  announcement,
}: {
  announcement: string
}) {
  const content = announcement.trim()

  if (!content) {
    return null
  }

  return <ConversationAnnouncementContent content={content} key={content} />
}

function ConversationAnnouncementContent({ content }: { content: string }) {
  const textRef = React.useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)

  React.useLayoutEffect(() => {
    if (expanded) {
      return
    }

    const text = textRef.current
    if (!text) {
      return
    }
    const measure = () =>
      setCanExpand(text.scrollHeight > text.clientHeight + 1)
    measure()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure)
      return () => window.removeEventListener("resize", measure)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => observer.disconnect()
  }, [content, expanded])

  return (
    <section
      aria-label="群公告"
      className="flex shrink-0 items-start gap-2 border-b bg-muted/30 px-5 py-2.5 text-sm"
    >
      <div className="flex min-w-0 flex-1 justify-center">
        <p
          className={cn(
            "w-fit max-w-full min-w-0 text-left leading-5 break-words whitespace-pre-wrap",
            !expanded && "line-clamp-3"
          )}
          ref={textRef}
        >
          {content}
        </p>
      </div>
      {canExpand && (
        <Button
          className="h-5 shrink-0 px-1.5 text-xs"
          onClick={() => setExpanded((value) => !value)}
          type="button"
          variant="ghost"
        >
          {expanded ? "收起" : "展开"}
        </Button>
      )}
    </section>
  )
}
