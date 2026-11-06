import { MessageContentIcon } from "@/components/message-content-icon"
import { cardSummary } from "../../../shared/card-summary"
import { cardDisplayTitle } from "../../../shared/card-title"
import { Link } from "react-router"
import { parseContactLink } from "../../../shared/contact-links"
import { parseTaskLink } from "../../../shared/task-links"

import type { ClientCardMessageBody } from "@/lib/client-data-api"

export function MessageCard({
  card,
  interactive = true,
}: {
  card: ClientCardMessageBody
  interactive?: boolean
}) {
  const target = interactive ? getCardTarget(card.url) : null
  const compact = Boolean(parseTaskLink(card.url) || parseContactLink(card.url))
  const className =
    (compact ? "flex items-center gap-3 overflow-hidden " : "grid gap-2 ") +
    "w-80 max-w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  const content = <CardContent card={card} />

  if (target?.type === "internal") {
    return (
      <Link
        aria-label={`${cardDisplayTitle(card.title, card.url)}，查看详情`}
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
        aria-label={`${cardDisplayTitle(card.title, card.url)}，查看详情`}
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
  const task = parseTaskLink(card.url)
  const contact = parseContactLink(card.url)
  if (task || contact) {
    const details = cardSummary(card.description, task ? "task" : contact!.type)
    return (
      <>
        <MessageContentIcon
          kind={task ? "task" : "contact"}
          className="size-7 shrink-0 text-foreground"
          strokeWidth={1.5}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            {cardDisplayTitle(card.title, card.url)}
          </div>
          {task ? (
            <div className="flex items-center text-xs text-muted-foreground">
              {details.status && (
                <span className="truncate">{details.status}</span>
              )}
              {details.status && details.priority && (
                <MessageContentIcon
                  kind="dot"
                  className="size-4 shrink-0"
                  strokeWidth={1.5}
                />
              )}
              {details.priority && (
                <span className="truncate">{details.priority}</span>
              )}
            </div>
          ) : (
            <div
              className="truncate text-xs text-muted-foreground"
              title={details.summary}
            >
              {details.summary}
            </div>
          )}
        </div>
      </>
    )
  }
  return (
    <>
      <div className="truncate text-sm">
        {cardDisplayTitle(card.title, card.url)}
      </div>
      {card.description.trim() && (
        <div className="line-clamp-3 text-xs leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
          {card.description}
        </div>
      )}
    </>
  )
}

function getCardTarget(url: string) {
  const value = url.trim()
  const task = parseTaskLink(value)
  if (task)
    return {
      href: `/projects/${task.projectId}?taskId=${task.taskId}`,
      type: "internal" as const,
    }
  const contact = parseContactLink(value)
  if (contact)
    return {
      href: `/contacts/${contact.type}/${contact.id}`,
      type: "internal" as const,
    }
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
