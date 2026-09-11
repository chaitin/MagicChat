import { SquareArrowOutUpRight } from "lucide-react"

import type { ClientLinkMessageBody } from "@/lib/client-data-api"

type MessageLinkProps = {
  link: ClientLinkMessageBody
}

export function MessageLink({ link }: MessageLinkProps) {
  return (
    <a
      className="grid w-80 max-w-full gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href={link.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      <div className="flex min-w-0 items-center gap-3">
        <SquareArrowOutUpRight className="size-4.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm leading-snug font-medium transition-colors group-hover/message-bubble:text-(--weui-link)">
          {link.title}
        </div>
      </div>
      <div className="truncate text-xs leading-snug text-muted-foreground">
        {link.url}
      </div>
    </a>
  )
}
