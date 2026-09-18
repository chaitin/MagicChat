import { Link01Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { cn } from "@/lib/utils"
import { MarkdownBody, TextBody } from "./text-body"

export function LinkBody({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex w-80 max-w-full items-start gap-3">
      <HugeiconsIcon
        icon={Link01Icon}
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <div className="line-clamp-2 font-medium">{title}</div>
        <div className="truncate text-xs text-xgui-link">{url}</div>
      </div>
    </div>
  )
}

export function CardBody({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  return (
    <div className="grid w-80 max-w-full gap-2">
      <div className="font-medium">{title}</div>
      <div className="line-clamp-3 text-muted-foreground">{description}</div>
      <div className="truncate text-xs text-xgui-link">{url}</div>
    </div>
  )
}

export function ChoiceBody({ body }: { body: Extract<DesktopMessageBody, { type: "choice" }> }) {
  return (
    <div className="grid w-80 max-w-full gap-3">
      {body.contentType === "markdown" ? (
        <MarkdownBody content={body.content} />
      ) : (
        <TextBody content={body.content} />
      )}
      <div className="grid gap-2">
        {body.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-left disabled:opacity-70"
          >
            <span
              className={cn(
                "size-3.5 shrink-0 border",
                body.selection === "single" ? "rounded-full" : "rounded-sm",
              )}
            />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
