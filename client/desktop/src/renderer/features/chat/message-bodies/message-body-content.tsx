import { MessageMultiple02Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { CollapsibleMessageContent } from "../collapsible-message-content"
import { ChartBody } from "./chart-body"
import { FileBody, ImageBody, VideoBody, VoiceBody } from "./media-body"
import { CardBody, ChoiceBody, LinkBody } from "./rich-body"
import { MarkdownBody, TextBody } from "./text-body"
import { formatDateTime } from "./utils"

export function MessageBodyContent({
  body,
  targetId,
  flushMedia = false,
  collapseLongContent = false,
}: {
  body: DesktopMessageBody
  targetId: string
  flushMedia?: boolean
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
      return <LinkBody title={body.title} url={body.url} />
    case "card":
      return <CardBody title={body.title} description={body.description} url={body.url} />
    case "chart":
      return <ChartBody body={body} />
    case "choice":
      return <ChoiceBody body={body} />
    case "forward_bundle":
      return <ForwardBundleBody body={body} targetId={targetId} />
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
}: {
  body: Extract<DesktopMessageBody, { type: "forward_bundle" }>
  targetId: string
}) {
  return (
    <details className="w-96 max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <HugeiconsIcon icon={MessageMultiple02Icon} className="size-4" aria-hidden />
        聊天记录（{body.itemCount}）
      </summary>
      <div className="mt-3 grid max-h-80 gap-3 overflow-y-auto border-t pt-3">
        {body.items.map((item, index) => (
          <div key={`${item.sentAt}-${index}`} className="grid gap-1 border-b pb-3 last:border-0">
            <div className="flex justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{item.senderName}</span>
              <span className="shrink-0">{formatDateTime(item.sentAt)}</span>
            </div>
            <MessageBodyContent body={item.body} targetId={targetId} collapseLongContent={false} />
          </div>
        ))}
      </div>
    </details>
  )
}
