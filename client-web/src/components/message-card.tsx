import { Link } from "react-router"

import { Separator } from "@/components/ui/separator"
import type { ClientCardMessageBody } from "@/lib/client-data-api"

export function MessageCard({
  card,
  interactive = true,
}: {
  card: ClientCardMessageBody
  interactive?: boolean
}) {
  const target = interactive ? getCardTarget(card.url) : null
  const className =
    "grid w-120 max-w-full gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  const content = <CardContent card={card} />

  if (target?.type === "internal") {
    return (
      <Link
        aria-label={`${card.title}，查看详情`}
        className={className}
        data-slot="message-card"
        to={target.href}
      >
        {content}
      </Link>
    )
  }

  if (target?.type === "external") {
    return (
      <a
        aria-label={`${card.title}，查看详情`}
        className={className}
        data-slot="message-card"
        href={target.href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {content}
      </a>
    )
  }

  return (
    <div className={className} data-slot="message-card">
      {content}
    </div>
  )
}

function CardContent({ card }: { card: ClientCardMessageBody }) {
  return (
    <>
      <div className="truncate text-sm leading-snug font-medium">
        {card.title}
      </div>
      {card.description.trim() && (
        <>
          <Separator className="bg-foreground/10" />
          <div className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {card.description}
          </div>
        </>
      )}
    </>
  )
}

function getCardTarget(url: string) {
  const value = url.trim()
  if (value.includes("\\") || /\s/.test(value)) {
    return null
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { href: value, type: "internal" as const }
  }

  if (!/^https?:\/\//i.test(value)) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname
    ) {
      return { href: parsed.href, type: "external" as const }
    }
  } catch {
    // Invalid targets render as a non-interactive card.
  }

  return null
}
