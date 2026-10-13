import { toast } from "sonner"
import type { ClientLinkMessageBody } from "@/lib/client-data-api"
import { MessageContentIcon } from "@/components/message-content-icon"

type MessageLinkProps = {
  link: ClientLinkMessageBody
}

export function MessageLink({ link }: MessageLinkProps) {
  const href = getWebLinkHref(link.url)
  const className = "flex w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success("链接已复制")
    } catch {
      toast.error("复制链接失败")
    }
  }
  const content = (
    <>
      <MessageContentIcon kind="link" className="size-7 shrink-0 text-foreground" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate pr-7 leading-6">{link.title || "链接"}</span>
        <span className="block max-w-full truncate text-xs text-muted-foreground" title={link.url}>
          {link.url}
        </span>
      </span>
    </>
  )
  return (
    <div className="relative w-80 max-w-full">
      {href ? (
        <a className={className} href={href} rel="noopener noreferrer" target="_blank">{content}</a>
      ) : (
        <div className={className}>{content}</div>
      )}
      <button
        type="button"
        aria-label="复制链接"
        title="复制链接"
        className="absolute right-0 top-0.5 flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => void copyLink()}
      >
        <MessageContentIcon kind="copy" className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
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
