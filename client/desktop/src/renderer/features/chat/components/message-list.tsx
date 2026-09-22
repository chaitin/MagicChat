import { Fragment, type RefObject } from "react"
import {
  AlertCircleIcon,
  ArrowDown02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  UploadCircle01Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopMessage } from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { MessageBodyRenderer } from "../message-body-renderer"
import { MessageReactionChips } from "../message-reaction-chips"
import { MessageReactionPicker } from "../message-reaction-picker"

export function MessageList({
  messages,
  loading,
  loadingBefore,
  historyRef,
  targetId,
  userId,
  userName,
  resolvedTheme,
  conversationName,
  showChoiceResponseCounts,
  mentionLabelResolver,
  pendingReactionKeys,
  highlightedMessageId,
  newMessageCount,
  onViewportScroll,
  onScrollToBottom,
  onReachTop,
  onSetReaction,
  onSubmitChoice,
  onRetryMessage,
  onPendingFeature,
}: {
  messages: DesktopMessage[]
  loading: boolean
  loadingBefore: boolean
  historyRef: RefObject<HTMLDivElement | null>
  targetId: string
  userId: string
  userName: string
  resolvedTheme: "light" | "dark"
  conversationName: string
  showChoiceResponseCounts: boolean
  mentionLabelResolver: MentionLabelResolver
  pendingReactionKeys: Set<string>
  highlightedMessageId: string | null
  newMessageCount: number
  onViewportScroll: (viewport: HTMLDivElement) => void
  onScrollToBottom: () => void
  onReachTop: () => void
  onSetReaction: (message: DesktopMessage, text: string, reacted: boolean) => Promise<void>
  onSubmitChoice: (message: DesktopMessage, optionIds: string[]) => Promise<void>
  onRetryMessage: (message: DesktopMessage) => void
  onPendingFeature: (label: string) => void
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <ScrollArea
        data-chat-history
        type="hover"
        scrollHideDelay={200}
        viewportRef={historyRef}
        onViewportScroll={(event) => {
          onViewportScroll(event.currentTarget)
          if (event.currentTarget.scrollTop <= 80) onReachTop()
        }}
        className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
        viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
      >
        <div className="min-h-full px-4 py-6">
          {loading ? (
            <div className="flex min-h-[inherit] items-center justify-center text-muted-foreground">
              <HugeiconsIcon
                icon={Loading03Icon}
                className="size-5 animate-spin"
                aria-label="正在读取聊天记录"
              />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[inherit] items-center justify-center text-sm text-muted-foreground">
              暂无聊天记录
            </div>
          ) : (
            <>
              {loadingBefore && (
                <div className="flex justify-center pb-4 text-muted-foreground">
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    className="size-4 animate-spin"
                    aria-label="正在加载更早消息"
                  />
                </div>
              )}
              <div className="flex w-full flex-col gap-5">
                {messages.map((message, index) => (
                  <Fragment key={message.id}>
                    {shouldShowMessageTimeMarker(messages[index - 1], message) && (
                      <div className="text-center text-xs text-muted-foreground">
                        {formatMessageTime(message.createdAt)}
                      </div>
                    )}
                    <MessageRow
                      message={message}
                      targetId={targetId}
                      userId={userId}
                      userName={userName}
                      resolvedTheme={resolvedTheme}
                      conversationName={conversationName}
                      showChoiceResponseCounts={showChoiceResponseCounts}
                      mentionLabelResolver={mentionLabelResolver}
                      pendingReactionKeys={pendingReactionKeys}
                      highlighted={message.id === highlightedMessageId}
                      onSetReaction={onSetReaction}
                      onSubmitChoice={onSubmitChoice}
                      onRetryMessage={onRetryMessage}
                      onPendingFeature={onPendingFeature}
                    />
                  </Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
      {newMessageCount > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-popover px-4 shadow-lg hover:bg-popover hover:text-xgui-brand dark:hover:bg-popover"
          onClick={onScrollToBottom}
        >
          <HugeiconsIcon icon={ArrowDown02Icon} className="size-4" aria-hidden />
          {newMessageCount} 条新消息
        </Button>
      )}
    </div>
  )
}

function MessageRow({
  message,
  targetId,
  userId,
  userName,
  resolvedTheme,
  conversationName,
  showChoiceResponseCounts,
  mentionLabelResolver,
  pendingReactionKeys,
  highlighted,
  onSetReaction,
  onSubmitChoice,
  onRetryMessage,
  onPendingFeature,
}: {
  message: DesktopMessage
  targetId: string
  userId: string
  userName: string
  resolvedTheme: "light" | "dark"
  conversationName: string
  showChoiceResponseCounts: boolean
  mentionLabelResolver: MentionLabelResolver
  pendingReactionKeys: Set<string>
  highlighted: boolean
  onSetReaction: (message: DesktopMessage, text: string, reacted: boolean) => Promise<void>
  onSubmitChoice: (message: DesktopMessage, optionIds: string[]) => Promise<void>
  onRetryMessage: (message: DesktopMessage) => void
  onPendingFeature: (label: string) => void
}) {
  if (message.body.type === "system_event") {
    return (
      <article
        data-message-id={message.id}
        className={cn(
          "flex justify-center rounded-lg transition-colors duration-300",
          highlighted && "bg-xgui-background-1",
        )}
      >
        <Badge variant="secondary">
          <MessageBodyRenderer
            body={message.body}
            targetId={targetId}
            currentUserId={userId}
            mentionLabelResolver={mentionLabelResolver}
            conversationName={conversationName}
          />
        </Badge>
      </article>
    )
  }

  const flushMediaBubble = shouldFlushMediaBubble(message)
  return (
    <article
      data-message-id={message.id}
      className={cn(
        "group/message-row flex items-start gap-2 rounded-lg transition-colors duration-300",
        highlighted && "bg-xgui-background-1",
        message.isMine ? "justify-end" : "justify-start",
      )}
    >
      {!message.isMine &&
        message.senderId &&
        (message.senderType === "user" || message.senderType === "app") && (
          <ContactProfilePopover
            type={message.senderType}
            id={message.senderId}
            fallbackName={message.senderName || conversationName}
          >
            <EntityAvatar
              targetId={targetId}
              type={message.senderType}
              id={message.senderId}
              theme={resolvedTheme}
              size={32}
              label={`${message.senderName || conversationName}头像`}
            />
          </ContactProfilePopover>
        )}
      <div
        className={cn(
          "flex max-w-[75%] min-w-0 flex-col gap-1",
          message.isMine ? "items-end" : "items-start",
        )}
      >
        <div className="flex max-w-full min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="max-w-32 truncate">
            {message.senderName ||
              (message.senderType === "system"
                ? "系统"
                : message.isMine
                  ? userName
                  : conversationName)}
          </span>
          <span className="shrink-0">{formatMessageTime(message.createdAt)}</span>
        </div>
        <div
          className={cn("flex max-w-full items-end gap-1.5", message.isMine && "flex-row-reverse")}
        >
          <div
            className={cn(
              "group/bubble max-w-full rounded-xl text-sm leading-6",
              flushMediaBubble ? "overflow-hidden p-0" : "px-3 py-2.5",
              message.isMine
                ? "rounded-tr-sm bg-xgui-brand-1 hover:bg-xgui-brand-6"
                : "rounded-tl-sm bg-muted hover:bg-xgui-background-6",
            )}
          >
            {message.replyTo && (
              <div className="mb-2 border-l-2 border-foreground/20 pl-2 text-xs">
                <div className="truncate font-medium text-foreground/80">
                  {message.replyTo.author}
                </div>
                <div className="line-clamp-2 text-muted-foreground">{message.replyTo.summary}</div>
              </div>
            )}
            <MessageBodyRenderer
              body={message.body}
              targetId={targetId}
              currentUserId={userId}
              mentionLabelResolver={mentionLabelResolver}
              conversationName={conversationName}
              messageId={message.id}
              choice={message.choice}
              showChoiceResponseCounts={showChoiceResponseCounts}
              onChoiceRespond={(optionIds) => onSubmitChoice(message, optionIds)}
              flushMedia={flushMediaBubble}
            />
            {message.reactions.length > 0 && (
              <div className={cn("max-w-full min-w-0", flushMediaBubble && "mx-2 mb-2")}>
                <MessageReactionChips
                  targetId={targetId}
                  conversationId={message.conversationId}
                  messageId={message.id}
                  reactions={message.reactions}
                  pendingKeys={pendingReactionKeys}
                  resolveLabel={mentionLabelResolver}
                  onSetReaction={(text, reacted) => onSetReaction(message, text, reacted)}
                />
              </div>
            )}
            {message.topic && (
              <div className="mt-2 border-t border-foreground/10 pt-2 text-xs text-muted-foreground">
                {message.topic.archived ? "话题已归档" : "查看话题回复"}
              </div>
            )}
          </div>
          <MessageStatus
            message={message}
            onRetry={() => onRetryMessage(message)}
            onSetReaction={(text) => onSetReaction(message, text, true)}
            onPendingFeature={onPendingFeature}
          />
        </div>
      </div>
      {message.isMine && (
        <ContactProfilePopover type="user" id={userId} fallbackName={userName}>
          <EntityAvatar
            targetId={targetId}
            type="user"
            id={userId}
            theme={resolvedTheme}
            size={32}
            label={`${userName}头像`}
          />
        </ContactProfilePopover>
      )}
    </article>
  )
}

function MessageStatus({
  message,
  onRetry,
  onSetReaction,
  onPendingFeature,
}: {
  message: DesktopMessage
  onRetry: () => void
  onSetReaction: (text: string) => Promise<void>
  onPendingFeature: (label: string) => void
}) {
  if (message.deliveryStatus === "sending") {
    return (
      <span className="mb-2 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-5 animate-spin"
          aria-label="消息发送中"
        />
      </span>
    )
  }
  if (message.deliveryStatus === "failed") {
    return (
      <button
        type="button"
        className="group/status mb-2 flex size-7 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
        aria-label="重试发送消息"
        title="发送失败，点击重试"
        onClick={onRetry}
      >
        <HugeiconsIcon
          icon={AlertCircleIcon}
          className="size-5 group-hover/status:hidden"
          aria-hidden
        />
        <HugeiconsIcon
          icon={UploadCircle01Icon}
          className="hidden size-5 group-hover/status:block"
          aria-hidden
        />
      </button>
    )
  }
  if (
    message.deliveryStatus ||
    message.body.type === "revoked" ||
    message.body.type === "unsupported"
  ) {
    return null
  }
  return (
    <div className="mb-2 flex h-7 shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/message-row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
      <MessageReactionPicker align={message.isMine ? "end" : "start"} onSelect={onSetReaction} />
      <MessageHoverActionButton
        label="更多操作"
        icon={MoreHorizontalIcon}
        onClick={() => onPendingFeature("消息更多操作")}
      />
    </div>
  )
}

function MessageHoverActionButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: HugeiconsIconProps["icon"]
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs outline-none transition-colors hover:text-xgui-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className="size-3.5" aria-hidden />
    </button>
  )
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  }
  return `${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}`
}

function shouldFlushMediaBubble(message: DesktopMessage) {
  return (
    (message.body.type === "image" || message.body.type === "video") &&
    !message.replyTo &&
    !message.topic
  )
}

function shouldShowMessageTimeMarker(
  previous: DesktopMessage | undefined,
  message: DesktopMessage,
) {
  if (!previous) return false
  const previousTime = new Date(previous.createdAt).getTime()
  const currentTime = new Date(message.createdAt).getTime()
  return (
    Number.isFinite(previousTime) &&
    Number.isFinite(currentTime) &&
    currentTime - previousTime > 60 * 60 * 1_000
  )
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0")
}
