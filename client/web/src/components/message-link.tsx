import type { ClientLinkMessageBody } from "@/lib/client-data-api"
import { MessageContentIcon } from "@/components/message-content-icon"

type MessageLinkProps = {
  link: ClientLinkMessageBody
}

export function MessageLink({ link }: MessageLinkProps) {
  const href = getWebLinkHref(link.url)
  const className = "flex w-80 max-w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const content = (
    <>
      <MessageContentIcon kind="link" className="size-7 shrink-0 text-foreground" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate leading-6">{link.title || "链接"}</span>
        <span className="block max-w-full truncate text-xs text-muted-foreground" title={link.url}>
          {link.url}
        </span>
      </span>
    </>
  )
  return href ? (
    <a className={className} href={href} rel="noopener noreferrer" target="_blank">{content}</a>
  ) : (
    <div className={className}>{content}</div>
  )
}

function getWebLinkHref(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}
