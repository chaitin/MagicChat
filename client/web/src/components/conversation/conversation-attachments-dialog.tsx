import * as React from "react"
import { FolderClosed, LoaderCircle } from "lucide-react"

import {
  listConversationAttachments,
  type ClientConversation,
  type ClientConversationAttachment,
} from "@/lib/client-data-api"
import { formatActivityTime } from "@/lib/activity-time"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { MessageAttachment } from "@/components/message-attachment"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const attachmentPageLimit = 50

export function ConversationAttachmentsDialog({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const [open, setOpen] = React.useState(false)
  const [attachments, setAttachments] = React.useState<
    ClientConversationAttachment[]
  >([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState("")
  const requestVersionRef = React.useRef(0)

  const requestAttachments = React.useCallback(
    (cursor: string | undefined) =>
      listConversationAttachments(conversation.id, {
        cursor,
        limit: attachmentPageLimit,
      }),
    [conversation.id]
  )

  const loadAttachments = React.useCallback(
    async (cursor: string | undefined, append: boolean) => {
      const requestVersion = ++requestVersionRef.current
      try {
        const page = await requestAttachments(cursor)
        if (requestVersionRef.current !== requestVersion) return
        setAttachments((current) =>
          append
            ? mergeAttachments(current, page.attachments)
            : page.attachments
        )
        setNextCursor(page.nextCursor)
      } catch (requestError) {
        if (requestVersionRef.current !== requestVersion) return
        setError(getClientDataErrorMessage(requestError, "加载历史附件失败"))
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [requestAttachments]
  )

  React.useEffect(() => {
    if (!open || conversation.type === "topic") return
    const requestVersion = ++requestVersionRef.current
    void requestAttachments(undefined)
      .then((page) => {
        if (requestVersionRef.current !== requestVersion) return
        setAttachments(page.attachments)
        setNextCursor(page.nextCursor)
      })
      .catch((requestError) => {
        if (requestVersionRef.current !== requestVersion) return
        setError(getClientDataErrorMessage(requestError, "加载历史附件失败"))
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) setLoading(false)
      })
    return () => {
      requestVersionRef.current += 1
    }
  }, [conversation.type, open, requestAttachments])

  if (conversation.type === "topic") return null

  function handleOpenChange(nextOpen: boolean) {
    requestVersionRef.current += 1
    setLoadingMore(false)
    if (nextOpen) {
      setAttachments([])
      setNextCursor(null)
      setError("")
      setLoading(true)
    } else {
      setLoading(false)
    }
    setOpen(nextOpen)
  }

  function handleRetry() {
    setError("")
    setLoading(true)
    void loadAttachments(undefined, false)
  }

  function handleLoadMore() {
    if (!nextCursor) return
    setError("")
    setLoadingMore(true)
    void loadAttachments(nextCursor, true)
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="历史附件"
          size="icon-sm"
          title="历史附件"
          type="button"
          variant="ghost"
        >
          <FolderClosed className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>历史附件</DialogTitle>
        </DialogHeader>

        <div className="min-h-40 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {loading ? (
            <AttachmentListStatus>
              <LoaderCircle className="size-5 animate-spin" />
              正在加载历史附件
            </AttachmentListStatus>
          ) : error && attachments.length === 0 ? (
            <AttachmentListStatus>
              <span>{error}</span>
              <Button onClick={handleRetry} size="sm" variant="outline">
                重试
              </Button>
            </AttachmentListStatus>
          ) : attachments.length === 0 ? (
            <AttachmentListStatus>
              <FolderClosed className="size-8 opacity-50" />
              暂无历史附件
            </AttachmentListStatus>
          ) : (
            <div className="grid min-w-0 gap-1">
              {attachments.map((attachment) => (
                <AttachmentListItem
                  attachment={attachment}
                  key={attachment.messageId}
                />
              ))}
              {error && (
                <div className="px-3 py-2 text-center text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {nextCursor && !loading && (
          <Button
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
            variant="outline"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
            加载更多
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AttachmentListItem({
  attachment,
}: {
  attachment: ClientConversationAttachment
}) {
  const createdAt = formatActivityTime(attachment.createdAt)
  return (
    <div className="flex w-full max-w-full min-w-0 items-start gap-3 overflow-hidden rounded-md px-3 py-3 hover:bg-muted">
      <div className="min-w-0 flex-1">
        <MessageAttachment file={attachment.file} />
      </div>
      {createdAt && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {createdAt}
        </span>
      )}
    </div>
  )
}

function AttachmentListStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function mergeAttachments(
  current: ClientConversationAttachment[],
  incoming: ClientConversationAttachment[]
) {
  const existingMessageIds = new Set(
    current.map((attachment) => attachment.messageId)
  )
  return [
    ...current,
    ...incoming.filter(
      (attachment) => !existingMessageIds.has(attachment.messageId)
    ),
  ]
}
