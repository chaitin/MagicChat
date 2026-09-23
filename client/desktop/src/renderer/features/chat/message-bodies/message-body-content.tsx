import { MessageMultiple02Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody, DesktopMessageChoiceState } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CollapsibleMessageContent } from "../collapsible-message-content"
import { ChartBody } from "./chart-body"
import { FileBody, ImageBody, VideoBody, VoiceBody } from "./media-body"
import { CardBody, ChoiceBody, LinkBody } from "./rich-body"
import { MarkdownBody, TextBody } from "./text-body"
import { formatDateTime } from "./utils"

export function MessageBodyContent({
  body,
  targetId,
  messageId,
  choice,
  showChoiceResponseCounts = false,
  onChoiceRespond,
  flushMedia = false,
  flushInteractiveCard = false,
  collapseLongContent = false,
}: {
  body: DesktopMessageBody
  targetId: string
  messageId?: string
  choice?: DesktopMessageChoiceState
  showChoiceResponseCounts?: boolean
  onChoiceRespond?: (optionIds: string[]) => Promise<void>
  flushMedia?: boolean
  flushInteractiveCard?: boolean
  collapseLongContent?: boolean
}) {
  switch (body.type) {
    case "text":
      return collapseLongContent ? (
        <CollapsibleMessageContent variant="text">
          <TextBody content={body.content} />
        </CollapsibleMessageContent>
      ) : (
        <TextBody content={body.content} />
      )
    case "markdown":
      return collapseLongContent ? (
        <CollapsibleMessageContent variant="markdown">
          <MarkdownBody content={body.content} />
        </CollapsibleMessageContent>
      ) : (
        <MarkdownBody content={body.content} />
      )
    case "image":
      return <ImageBody body={body} targetId={targetId} flush={flushMedia} />
    case "video":
      return <VideoBody body={body} targetId={targetId} flush={flushMedia} />
    case "file":
      return <FileBody body={body} />
    case "voice":
      return <VoiceBody body={body} targetId={targetId} />
    case "link":
      return <LinkBody title={body.title} url={body.url} flush={flushInteractiveCard} />
    case "card":
      return <CardBody title={body.title} description={body.description} url={body.url} />
    case "chart":
      return <ChartBody body={body} />
    case "choice":
      return (
        <ChoiceBody
          body={body}
          messageId={messageId}
          choice={choice}
          showResponseCounts={showChoiceResponseCounts}
          onRespond={onChoiceRespond}
        />
      )
    case "forward_bundle":
      return <ForwardBundleBody body={body} targetId={targetId} flush={flushInteractiveCard} />
    case "system_event":
      return <span>{body.summary}</span>
    case "revoked":
      return <span className="text-muted-foreground">该消息已被撤回</span>
    case "unsupported":
      return <span className="text-muted-foreground">暂不支持查看该消息</span>
  }
}

function ForwardBundleBody({
  body,
  targetId,
  flush,
}: {
  body: Extract<DesktopMessageBody, { type: "forward_bundle" }>
  targetId: string
  flush: boolean
}) {
  const summary = forwardBundleSummary(body)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-80 max-w-full cursor-pointer items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
            flush && "px-3 py-2.5",
          )}
          aria-label={summary}
        >
          <HugeiconsIcon
            icon={MessageMultiple02Icon}
            className="size-7 shrink-0 text-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">聊天记录</span>
            <span
              className="block max-w-full truncate text-xs text-muted-foreground"
              title={summary}
            >
              {summary.replace(/^\[聊天记录\]\s*/, "")}
            </span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="grid max-h-[80vh] grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>聊天记录</DialogTitle>
        </DialogHeader>
        <ScrollArea
          className="min-h-0 rounded-md border select-text"
          viewportClassName="overscroll-contain [&>div]:block! [&>div]:w-full!"
        >
          <div className="px-4">
            {body.items.map((item, index) => (
              <div className="border-b py-4 last:border-b-0" key={`${item.sentAt}-${index}`}>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground/80">{item.senderName}</span>
                  <span className="shrink-0">{formatDateTime(item.sentAt)}</span>
                </div>
                <div className="w-fit max-w-full rounded-md bg-zinc-100 p-3 dark:bg-zinc-800">
                  <MessageBodyContent
                    body={item.body}
                    targetId={targetId}
                    collapseLongContent={false}
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function forwardBundleSummary(body: Extract<DesktopMessageBody, { type: "forward_bundle" }>) {
  const characters = Array.from(body.items[0]?.summary.trim() ?? "")
  const preview =
    characters.length <= 100 ? characters.join("") : `${characters.slice(0, 100).join("").trim()}…`
  return `[聊天记录] ${body.itemCount} 条 - ${preview || "消息"}`
}
