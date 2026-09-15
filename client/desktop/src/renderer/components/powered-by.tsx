import type { ComponentProps, MouseEvent } from "react"
import { cn } from "cn"
import { JIYING_HOMEPAGE } from "../../shared/desktop"

export function PoweredBy({ className, ...props }: ComponentProps<"footer">) {
  async function openHomepage(event: MouseEvent<HTMLAnchorElement>) {
    if (!window.desktop) return
    event.preventDefault()
    await window.desktop.openHomepage()
  }

  return (
    <footer
      className={cn("text-center text-xs text-black/40 dark:text-white/40", className)}
      data-slot="powered-by"
      {...props}
    >
      当前系统由
      <a
        href={JIYING_HOMEPAGE}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-1 underline underline-offset-4 transition-colors hover:text-primary"
        onClick={(event) => void openHomepage(event)}
      >
        即应 Chat
      </a>
      驱动
    </footer>
  )
}
