import * as React from "react"
import { LoaderCircle, MessageCircle } from "lucide-react"
import { type ClientConversation } from "@/lib/client-data-api"
import { type MentionLabelResolver } from "@/lib/message-mentions"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  MessageBubble,
  SystemMessageBadge,
} from "@/components/conversation/conversation-message"
import type {
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelMessageSelection,
} from "@/lib/conversation-panel-types"

export function ConversationPanelHistory({
  conversation,
  currentUserId,
  error,
  loading,
  loadingBefore,
  mentionLabelResolver,
  messages,
  messageSelection,
  onForwardMessage,
  onLoadBeforeMessages,
  onStartMessageSelection,
  onInsertMention,
  onReplyToMessage,
  onRevokeMessage,
  onToggleMessageSelection,
}: {
  conversation: ClientConversation
  currentUserId: string
  error: string | null
  loading: boolean
  loadingBefore: boolean
  mentionLabelResolver: MentionLabelResolver
  messages: ConversationPanelMessage[]
  messageSelection?: ConversationPanelMessageSelection
  onForwardMessage?: (message: ConversationPanelMessage) => void
  onLoadBeforeMessages: () => void
  onStartMessageSelection?: (message: ConversationPanelMessage) => void
  onInsertMention: (target: ConversationPanelMentionTarget) => void
  onReplyToMessage: (message: ConversationPanelMessage) => void
  onRevokeMessage: (message: ConversationPanelMessage) => void
  onToggleMessageSelection?: (message: ConversationPanelMessage) => void
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const previousConversationIdRef = React.useRef<string | null>(null)
  const previousFirstMessageIdRef = React.useRef<string | null>(null)
  const previousLastMessageIdRef = React.useRef<string | null>(null)
  const previousMessagesLengthRef = React.useRef(0)
  const beforeLoadSnapshotRef = React.useRef<{
    scrollHeight: number
    scrollTop: number
  } | null>(null)

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const firstMessageId = messages[0]?.id ?? null
    const lastMessageId = messages[messages.length - 1]?.id ?? null
    const previousConversationId = previousConversationIdRef.current
    const previousFirstMessageId = previousFirstMessageIdRef.current
    const previousLastMessageId = previousLastMessageIdRef.current
    const previousMessagesLength = previousMessagesLengthRef.current
    const changedConversation = previousConversationId !== conversation.id

    if (changedConversation) {
      scrollToBottom(viewport)
      beforeLoadSnapshotRef.current = null
    } else if (
      firstMessageId &&
      previousFirstMessageId &&
      firstMessageId !== previousFirstMessageId &&
      beforeLoadSnapshotRef.current
    ) {
      const snapshot = beforeLoadSnapshotRef.current
      viewport.scrollTop =
        snapshot.scrollTop + (viewport.scrollHeight - snapshot.scrollHeight)
      beforeLoadSnapshotRef.current = null
    } else if (
      lastMessageId &&
      previousLastMessageId !== lastMessageId &&
      messages.length >= previousMessagesLength
    ) {
      scrollToBottom(viewport)
    }

    previousConversationIdRef.current = conversation.id
    previousFirstMessageIdRef.current = firstMessageId
    previousLastMessageIdRef.current = lastMessageId
    previousMessagesLengthRef.current = messages.length
  }, [conversation.id, messages])

  function handleViewportScroll(event: React.UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget

    if (loadingBefore || viewport.scrollTop > 80) {
      return
    }

    beforeLoadSnapshotRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    }
    onLoadBeforeMessages()
  }

  function handleHistoryContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-message-action-trigger]")
    ) {
      return
    }

    event.preventDefault()
  }

  if (loading) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-muted/10 text-sm text-muted-foreground"
        data-testid="conversation-history-loading"
      >
        <LoaderCircle className="size-4 animate-spin" />
        <span>正在加载消息</span>
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center bg-muted/10 px-6 text-center text-sm text-muted-foreground"
        data-testid="conversation-history-error"
      >
        {error}
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <Empty
        className="h-full min-h-0 flex-1 rounded-none bg-muted/10"
        data-testid="conversation-history-empty"
      >
        <EmptyMedia>
          <MessageCircle className="size-14 text-muted-foreground/25" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>暂无消息</EmptyTitle>
          <EmptyDescription>发送第一条消息开始对话</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ScrollArea
      className="min-h-0 flex-1 bg-muted/10"
      data-testid="conversation-panel-history"
      viewportProps={{
        className:
          "[&>div]:block! [&>div]:w-full! [&>div]:min-w-0!",
        onContextMenu: handleHistoryContextMenu,
        onScroll: handleViewportScroll,
      }}
      viewportRef={viewportRef}
    >
      <div
        className="flex w-full flex-col gap-5 px-5 py-6"
        data-testid="conversation-history-content"
      >
        {loadingBefore && (
          <div
            className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
            data-testid="conversation-history-loading-before"
          >
            <LoaderCircle className="size-3.5 animate-spin" />
            <span>正在加载更早消息</span>
          </div>
        )}
        {messages.map((message) =>
          message.role === "system" ? (
            <SystemMessageBadge
              key={message.id}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
              message={message}
            />
          ) : (
            <MessageBubble
              key={message.id}
              message={message}
              conversation={conversation}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
              onForward={
                message.body.type !== "revoked" ? onForwardMessage : undefined
              }
              onInsertMention={onInsertMention}
              onMultiSelect={
                message.body.type !== "revoked"
                  ? onStartMessageSelection
                  : undefined
              }
              onReply={onReplyToMessage}
              onRevoke={onRevokeMessage}
              onToggleSelected={onToggleMessageSelection}
              selectable={message.body.type !== "revoked"}
              selected={messageSelection?.selectedMessageIds.has(message.id)}
              selectionMode={messageSelection?.active}
            />
          )
        )}
      </div>
    </ScrollArea>
  )
}

function scrollToBottom(viewport: HTMLDivElement) {
  viewport.scrollTop = viewport.scrollHeight
}
