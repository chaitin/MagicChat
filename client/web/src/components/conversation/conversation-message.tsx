import * as React from "react"
import { Bot, LoaderCircle, MessagesSquare } from "lucide-react"
import { toast } from "sonner"
import { getAvatarInitial } from "@/lib/avatar"
import { cn } from "@/lib/utils"
import {
  formatClientMessageBodySummary,
  type ClientConversation,
  type ClientMessage,
  type ClientMessageChoiceState,
} from "@/lib/client-data-api"
import {
  formatMentionTemplateText,
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { getImageThumbnailFrame } from "@/lib/image-message-thumbnail"
import { AppProfilePopover } from "@/components/app-profile-popover"
import { MessageAttachment } from "@/components/message-attachment"
import { MessageImage } from "@/components/message-image"
import { MessageTextWithLinks } from "@/components/message-inline-link"
import { MessageLink } from "@/components/message-link"
import { MessageMarkdown } from "@/components/message-markdown"
import { MessageCard } from "@/components/message-card"
import { MessageRenderErrorBoundary } from "@/components/message-render-error-boundary"
import { MessageVideo } from "@/components/message-video"
import { MessageVoice } from "@/components/message-voice"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  MessageActionMenu,
  MessageMoreActionsMenu,
  type MessageActionOptions,
} from "@/components/message-action-menu"
import {
  MessageReactionAddButton,
  MessageReactionChips,
} from "@/components/conversation/message-reactions"
import { CollapsibleMessageContent } from "@/components/conversation/collapsible-message-content"
import { messageReactionChipToneClassName } from "@/components/conversation/message-reaction-styles"
import { UserProfilePopover } from "@/components/user-profile-popover"
import type {
  ConversationPanelMentionTarget,
  ConversationPanelMessage,
  ConversationPanelReplyTarget,
} from "@/lib/conversation-panel-types"

const MessageChart = React.lazy(async () => {
  const module = await import("@/components/message-chart")
  return { default: module.MessageChart }
})

export const SystemMessageBadge = React.memo(function SystemMessageBadge({
  currentUserId,
  mentionLabelResolver,
  message,
}: {
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  message: ConversationPanelMessage
}) {
  return (
    <div
      className="flex justify-center"
      data-conversation-message-id={message.id}
    >
      <Badge
        className="h-auto max-w-[min(80%,36rem)] text-center leading-relaxed whitespace-normal"
        variant="secondary"
      >
        <MessageBodyRenderer
          body={message.body}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      </Badge>
    </div>
  )
}, areSystemMessageBadgePropsEqual)

type MessageBubbleProps = {
  message: ConversationPanelMessage
  conversation: ClientConversation
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  onInsertMention: (target: ConversationPanelMentionTarget) => void
  onForward?: (message: ConversationPanelMessage) => void
  onCreateTopic?: (message: ConversationPanelMessage) => void
  onMultiSelect?: (message: ConversationPanelMessage) => void
  onReeditRevoked?: (message: ConversationPanelMessage) => void
  onReply?: (message: ConversationPanelMessage) => void
  onOpenTopic?: (conversationId: string) => void
  onRevoke?: (message: ConversationPanelMessage) => void
  onSetReaction?: (
    message: ConversationPanelMessage,
    text: string,
    reacted: boolean
  ) => Promise<void>
  onRespondToChoice?: (
    message: ConversationPanelMessage,
    optionIds: string[]
  ) => Promise<void>
  onToggleSelected?: (message: ConversationPanelMessage) => void
  selectable?: boolean
  canReply?: boolean
  selected?: boolean
  selectionMode?: boolean
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  conversation,
  currentUserId,
  mentionLabelResolver,
  onInsertMention,
  onForward,
  onCreateTopic,
  onMultiSelect,
  onReeditRevoked,
  onReply,
  onOpenTopic,
  onRevoke,
  onSetReaction,
  onRespondToChoice,
  onToggleSelected,
  selectable = true,
  canReply = true,
  selected = false,
  selectionMode = false,
}: MessageBubbleProps) {
  const fromMe = message.role === "me"
  const fallback = message.senderAppId ? (
    <Bot className="size-4" />
  ) : fromMe ? (
    "我"
  ) : (
    getAvatarInitial(conversation.name)
  )
  const canInsertAuthorMention =
    canReply &&
    (conversation.type === "group" ||
      conversation.topic?.parentConversationType === "group") &&
    message.mentionTarget !== null
  const showChoiceResponseCounts =
    conversation.type === "group" ||
    conversation.topic?.parentConversationType === "group"
  const unavailable =
    message.body.type === "revoked" || message.body.type === "unsupported"
  const canAddReaction = canReply && message.body.type !== "revoked"
  const copyText = getMessageCopyText(message, mentionLabelResolver)
  const bubbleRef = React.useRef<HTMLDivElement | null>(null)
  const selectedCopyTextRef = React.useRef("")
  function handleMessageContextMenu() {
    selectedCopyTextRef.current = getSelectedTextWithinElement(
      bubbleRef.current
    )
  }

  function handleCopyMessage() {
    const selectedText = selectedCopyTextRef.current
    selectedCopyTextRef.current = ""

    void copyMessageToClipboard(
      message,
      selectedText,
      bubbleRef.current,
      mentionLabelResolver
    )
  }

  function handleMoreActionsOpenChange(open: boolean) {
    if (open) {
      selectedCopyTextRef.current = ""
    }
  }

  function handleAuthorMentionClick() {
    if (!message.mentionTarget) {
      return
    }

    onInsertMention(message.mentionTarget)
  }

  function handleSelectionClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!selectionMode || !selectable || !onToggleSelected) {
      return
    }
    if (
      event.target instanceof Element &&
      event.target.closest("[data-slot=checkbox]")
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onToggleSelected(message)
  }

  const flushImageBubble =
    (message.body.type === "image" || message.body.type === "video") &&
    !message.replyTo &&
    !message.topic
  const roundVideoBottom = !(
    message.body.type === "video" &&
    (message.body.caption || message.reactions.length > 0 || message.topic)
  )
  const messageActionOptions: MessageActionOptions = {
    canRevoke: Boolean(onRevoke) && message.canRevoke,
    copyDisabled: !copyText,
    hideCopy: message.body.type === "image" || message.body.type === "video",
    onCopy: handleCopyMessage,
    onCreateTopic:
      onCreateTopic && !message.topic
        ? () => onCreateTopic(message)
        : undefined,
    onForward: onForward ? () => onForward(message) : undefined,
    onMultiSelect: onMultiSelect ? () => onMultiSelect(message) : undefined,
    onReply: canReply && onReply ? () => onReply(message) : undefined,
    onRevoke: onRevoke ? () => onRevoke(message) : undefined,
  }

  const messageBody = (
    <div
      className={cn(
        "group/message-bubble min-w-0 rounded-md text-sm leading-relaxed shadow-sm",
        message.topic
          ? "max-w-[calc(30rem+1.5rem)]"
          : message.body.type === "text"
            ? "max-w-120"
            : "max-w-full",
        flushImageBubble ? "overflow-hidden p-0" : "p-3",
        fromMe
          ? "bg-(--weui-brand-1) text-foreground hover:bg-(--weui-brand-1) data-[state=open]:bg-(--weui-brand-1)"
          : "bg-zinc-100 text-foreground dark:bg-zinc-800",
        !selectionMode &&
          !fromMe &&
          "hover:bg-zinc-200/60 data-[state=open]:bg-zinc-200 hover:dark:bg-zinc-700/60 dark:data-[state=open]:bg-zinc-700"
      )}
      data-message-action-trigger={
        !selectionMode && !unavailable ? "" : undefined
      }
      onContextMenu={
        !selectionMode && !unavailable ? handleMessageContextMenu : undefined
      }
      ref={bubbleRef}
    >
      {message.replyTo && <MessageReplyReference replyTo={message.replyTo} />}
      {message.body.type === "choice" ? (
        <MessageChoiceBody
          align={fromMe ? "end" : "start"}
          body={message.body}
          canRespond={canReply && !selectionMode && Boolean(onRespondToChoice)}
          choice={message.choice}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
          messageId={message.id}
          onRespond={
            onRespondToChoice
              ? (optionIds) => onRespondToChoice(message, optionIds)
              : undefined
          }
          showResponseCounts={showChoiceResponseCounts}
        />
      ) : (
        <MessageBodyRenderer
          body={message.body}
          collapseLongContent={!selectionMode}
          currentUserId={currentUserId}
          flushImage={flushImageBubble}
          mentionLabelResolver={mentionLabelResolver}
          onReeditRevoked={
            fromMe && !selectionMode && onReeditRevoked
              ? () => onReeditRevoked(message)
              : undefined
          }
          roundVideoBottom={roundVideoBottom}
        />
      )}
      {!selectionMode && message.reactions.length > 0 && (
        <div className={cn("mt-2", flushImageBubble && "mx-2 mb-2")}>
          <MessageReactionChips
            align={fromMe ? "end" : "start"}
            canAdd={canAddReaction}
            conversationId={conversation.id}
            enabled={message.body.type !== "revoked"}
            expandBubble={
              message.body.type === "text" || message.body.type === "markdown"
            }
            messageId={message.id}
            onSetReaction={
              onSetReaction
                ? (text, reacted) => onSetReaction(message, text, reacted)
                : undefined
            }
            reactions={message.reactions}
          />
        </div>
      )}
      {message.topic && onOpenTopic && (
        <TopicReplyPreview
          onOpen={
            selectionMode
              ? undefined
              : () => onOpenTopic(message.topic!.conversationId)
          }
          topic={message.topic}
        />
      )}
    </div>
  )
  const renderedMessageBody =
    selectionMode || unavailable ? (
      messageBody
    ) : (
      <MessageActionMenu {...messageActionOptions}>
        {messageBody}
      </MessageActionMenu>
    )

  return (
    <div
      className={cn(
        "group/message-row relative rounded-md transition-colors",
        selectionMode && "px-3 py-2 pl-11",
        selected && "bg-primary/5"
      )}
      data-conversation-message-id={message.id}
      data-message-selection-row
      onClickCapture={handleSelectionClick}
    >
      {selectionMode && (
        <Checkbox
          aria-label={`${selected ? "取消选择" : "选择"}${message.author}的消息`}
          checked={selected}
          className="absolute top-4 left-3"
          disabled={!selectable}
          onCheckedChange={() => onToggleSelected?.(message)}
        />
      )}
      <div
        className={cn("flex gap-3", fromMe ? "justify-end" : "justify-start")}
      >
        {!fromMe && <MessageAvatar fallback={fallback} message={message} />}
        <div
          className={cn(
            "flex max-w-[min(70%,64rem)] min-w-0 flex-col gap-1",
            fromMe ? "items-end" : "items-start"
          )}
        >
          <div className="flex max-w-full min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {canInsertAuthorMention && !selectionMode ? (
              <button
                className="max-w-32 cursor-pointer truncate p-0 text-muted-foreground transition-colors hover:text-(--weui-link)"
                onClick={handleAuthorMentionClick}
                onMouseDown={(event) => event.preventDefault()}
                title={message.author}
                type="button"
              >
                {message.author}
              </button>
            ) : (
              <span className="max-w-32 truncate" title={message.author}>
                {message.author}
              </span>
            )}
            <span className="shrink-0">{message.time}</span>
          </div>
          <div
            className={cn(
              "flex max-w-full items-end gap-1.5",
              fromMe && "flex-row-reverse"
            )}
            data-slot="message-bubble-line"
          >
            {renderedMessageBody}
            {message.deliveryStatus === "sending" && (
              <LoaderCircle
                aria-label="消息发送中"
                className="size-4 animate-spin text-muted-foreground"
              />
            )}
            {message.deliveryStatus === "failed" && (
              <Button
                aria-label="重试发送消息"
                className="size-6 text-destructive hover:text-destructive"
                onClick={message.retry}
                size="icon"
                title="发送失败，点击重试"
                variant="ghost"
              >
                <svg
                  aria-hidden="true"
                  className="size-4"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <circle cx="8" cy="8" r="7" />
                  <path
                    d="M8 4.25v4.5M8 11.5h.01"
                    fill="none"
                    stroke="white"
                    strokeLinecap="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </Button>
            )}
            {!selectionMode && !unavailable && (
              <div
                className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/message-row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
                data-slot="message-hover-actions"
              >
                {onSetReaction && canAddReaction && (
                  <MessageReactionAddButton
                    align={fromMe ? "end" : "start"}
                    onSetReaction={(text, reacted) =>
                      onSetReaction(message, text, reacted)
                    }
                  />
                )}
                <MessageMoreActionsMenu
                  {...messageActionOptions}
                  align={fromMe ? "end" : "start"}
                  onOpenChange={handleMoreActionsOpenChange}
                />
              </div>
            )}
          </div>
          {message.delegatedByName && (
            <div className="text-xs text-muted-foreground">
              由 {message.delegatedByName} 代发
            </div>
          )}
        </div>
        {fromMe && (
          <MessageAvatar
            fallback="我"
            fallbackClassName="bg-primary text-primary-foreground"
            message={message}
          />
        )}
      </div>
    </div>
  )
}, areMessageBubblePropsEqual)

function areSystemMessageBadgePropsEqual(
  previous: {
    currentUserId: string
    mentionLabelResolver: MentionLabelResolver
    message: ConversationPanelMessage
  },
  next: {
    currentUserId: string
    mentionLabelResolver: MentionLabelResolver
    message: ConversationPanelMessage
  }
) {
  return (
    previous.currentUserId === next.currentUserId &&
    previous.message.body === next.message.body &&
    (previous.mentionLabelResolver === next.mentionLabelResolver ||
      !messageBodyUsesMentionLabels(next.message.body))
  )
}

function areMessageBubblePropsEqual(
  previous: MessageBubbleProps,
  next: MessageBubbleProps
) {
  return (
    previous.conversation.name === next.conversation.name &&
    previous.conversation.type === next.conversation.type &&
    previous.currentUserId === next.currentUserId &&
    previous.onForward === next.onForward &&
    previous.onCreateTopic === next.onCreateTopic &&
    previous.onInsertMention === next.onInsertMention &&
    previous.onMultiSelect === next.onMultiSelect &&
    previous.onReeditRevoked === next.onReeditRevoked &&
    previous.onReply === next.onReply &&
    previous.canReply === next.canReply &&
    previous.onOpenTopic === next.onOpenTopic &&
    previous.onRevoke === next.onRevoke &&
    previous.onSetReaction === next.onSetReaction &&
    previous.onRespondToChoice === next.onRespondToChoice &&
    previous.onToggleSelected === next.onToggleSelected &&
    previous.selectable === next.selectable &&
    previous.selected === next.selected &&
    previous.selectionMode === next.selectionMode &&
    arePanelMessagesEqual(previous.message, next.message) &&
    (previous.mentionLabelResolver === next.mentionLabelResolver ||
      !messageBodyUsesMentionLabels(next.message.body))
  )
}

function arePanelMessagesEqual(
  previous: ConversationPanelMessage,
  next: ConversationPanelMessage
) {
  return (
    previous.id === next.id &&
    previous.author === next.author &&
    previous.avatar === next.avatar &&
    previous.body === next.body &&
    areMessageChoicesEqual(previous.choice, next.choice) &&
    previous.canRevoke === next.canRevoke &&
    previous.delegatedByName === next.delegatedByName &&
    previous.deliveryStatus === next.deliveryStatus &&
    previous.retry === next.retry &&
    previous.reactionVersion === next.reactionVersion &&
    previous.role === next.role &&
    previous.senderAppId === next.senderAppId &&
    previous.senderUserId === next.senderUserId &&
    previous.time === next.time &&
    areMessageTopicsEqual(previous.topic, next.topic) &&
    areMentionTargetsEqual(previous.mentionTarget, next.mentionTarget) &&
    areReplyTargetsEqual(previous.replyTo, next.replyTo) &&
    areAppProfilesEqual(previous.senderAppProfile, next.senderAppProfile)
  )
}

function areMessageChoicesEqual(
  previous: ConversationPanelMessage["choice"],
  next: ConversationPanelMessage["choice"]
) {
  if (previous === next) {
    return true
  }
  if (
    !previous ||
    !next ||
    previous.responseCount !== next.responseCount ||
    previous.myOptionIds.length !== next.myOptionIds.length ||
    previous.options.length !== next.options.length
  ) {
    return false
  }
  return (
    previous.myOptionIds.every((id, index) => id === next.myOptionIds[index]) &&
    previous.options.every((option, index) => {
      const nextOption = next.options[index]
      return (
        option.id === nextOption.id &&
        option.responseCount === nextOption.responseCount
      )
    })
  )
}

function areMessageTopicsEqual(
  previous: ConversationPanelMessage["topic"],
  next: ConversationPanelMessage["topic"]
) {
  if (previous === next) {
    return true
  }
  if (
    !previous ||
    !next ||
    previous.archived !== next.archived ||
    previous.conversationId !== next.conversationId ||
    previous.recentReplies.length !== next.recentReplies.length
  ) {
    return false
  }
  return previous.recentReplies.every((reply, index) => {
    const nextReply = next.recentReplies[index]
    return (
      reply.id === nextReply.id &&
      reply.author === nextReply.author &&
      reply.avatar === nextReply.avatar &&
      reply.summary === nextReply.summary &&
      reply.time === nextReply.time
    )
  })
}

function areMentionTargetsEqual(
  previous: ConversationPanelMessage["mentionTarget"],
  next: ConversationPanelMessage["mentionTarget"]
) {
  return (
    previous === next ||
    (previous !== null &&
      next !== null &&
      previous.id === next.id &&
      previous.label === next.label &&
      previous.targetType === next.targetType)
  )
}

function areReplyTargetsEqual(
  previous: ConversationPanelMessage["replyTo"],
  next: ConversationPanelMessage["replyTo"]
) {
  return (
    previous === next ||
    (previous !== undefined &&
      next !== undefined &&
      previous.id === next.id &&
      previous.author === next.author &&
      previous.summary === next.summary)
  )
}

function areAppProfilesEqual(
  previous: ConversationPanelMessage["senderAppProfile"],
  next: ConversationPanelMessage["senderAppProfile"]
) {
  return (
    previous === next ||
    (previous !== null &&
      next !== null &&
      previous.id === next.id &&
      previous.avatar === next.avatar &&
      previous.description === next.description &&
      previous.name === next.name &&
      previous.online === next.online)
  )
}

async function copyMessageToClipboard(
  message: ConversationPanelMessage,
  selectedText: string,
  messageElement: HTMLElement | null,
  mentionLabelResolver: MentionLabelResolver
) {
  const text =
    (selectedText.trim()
      ? selectedText
      : getSelectedTextWithinElement(messageElement)) ||
    getMessageCopyText(message, mentionLabelResolver)
  if (!text) {
    toast.error("没有可复制内容")
    return
  }

  try {
    await writeClipboardText(text)
    toast.success("已复制")
  } catch {
    toast.error("复制失败")
  }
}

function getSelectedTextWithinElement(element: HTMLElement | null) {
  if (!element) {
    return ""
  }

  const selection = window.getSelection()
  const selectedText = selection?.toString() ?? ""
  if (!selection || selection.isCollapsed || !selectedText.trim()) {
    return ""
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (rangeIntersectsElement(selection.getRangeAt(index), element)) {
      return selectedText
    }
  }

  return ""
}

function rangeIntersectsElement(range: Range, element: HTMLElement) {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

function getMessageCopyText(
  message: ConversationPanelMessage,
  mentionLabelResolver: MentionLabelResolver
) {
  switch (message.body.type) {
    case "file":
      return message.body.name
    case "image":
    case "video":
      return ""
    case "voice":
      return ""
    case "revoked":
      return ""
    case "unsupported":
      return ""
    case "link":
      return message.body.url
    case "card":
      return `${message.body.title}\n${message.body.description}\n${message.body.url}`
    case "chart":
      return `${message.body.title}\n${message.body.description}`
    case "markdown":
    case "text":
      return formatMentionTemplateText(
        message.body.content,
        mentionLabelResolver
      )
    case "choice":
      return formatClientMessageBodySummary(message.body)
    case "forward_bundle":
      return formatClientMessageBodySummary(message.body)
    case "system_event":
      return formatClientMessageBodySummary(message.body)
  }
}

async function writeClipboardText(text: string) {
  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    throw new Error("clipboard is unavailable")
  }

  await navigator.clipboard.writeText(text)
}

function MessageReplyReference({
  replyTo,
}: {
  replyTo: ConversationPanelReplyTarget
}) {
  return (
    <div className="mb-2 border-l-2 border-foreground/20 pl-2 text-xs">
      <div className="truncate font-medium text-foreground/80">
        {replyTo.author}
      </div>
      <div className="line-clamp-2 text-muted-foreground">
        {replyTo.summary}
      </div>
    </div>
  )
}

export function MessageChoiceBody({
  align,
  body,
  canRespond,
  choice,
  currentUserId,
  mentionLabelResolver,
  messageId,
  onRespond,
  showResponseCounts,
}: {
  align: "start" | "end"
  body: Extract<ClientMessage["body"], { type: "choice" }>
  canRespond: boolean
  choice?: ClientMessageChoiceState
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  messageId: string
  onRespond?: (optionIds: string[]) => Promise<void>
  showResponseCounts: boolean
}) {
  const answered = Boolean(choice?.myOptionIds.length)
  const [draftOptionIds, setDraftOptionIds] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const selectedOptionIds = answered
    ? (choice?.myOptionIds ?? [])
    : draftOptionIds

  const choiceOptions = body.options

  const countsByOptionId = new Map(
    choice?.options.map((option) => [option.id, option.responseCount]) ?? []
  )

  async function submitResponse() {
    if (!onRespond || answered || selectedOptionIds.length === 0) {
      return
    }
    setSubmitting(true)
    try {
      await onRespond(selectedOptionIds)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交选择失败")
    } finally {
      setSubmitting(false)
    }
  }

  function toggleMultipleOption(optionId: string, checked: boolean) {
    setDraftOptionIds((current) =>
      checked
        ? choiceOptions
            .map((option) => option.id)
            .filter((id) => id === optionId || current.includes(id))
        : current.filter((id) => id !== optionId)
    )
  }

  return (
    <div className="w-120 max-w-full" data-slot="choice-message">
      <div className="mb-3">
        {body.contentType === "markdown" ? (
          <MessageMarkdown
            content={body.content}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
          />
        ) : (
          <TextMessageBody
            content={body.content}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
          />
        )}
      </div>
      {body.selection === "single" ? (
        <RadioGroup
          className="gap-2"
          disabled={!canRespond || answered || submitting}
          onValueChange={(value) => setDraftOptionIds([value])}
          value={selectedOptionIds[0] ?? ""}
        >
          {choiceOptions.map((option) => (
            <ChoiceOptionRow
              align={align}
              control={
                <RadioGroupItem
                  aria-label={option.label}
                  id={`${messageId}-${option.id}`}
                  value={option.id}
                />
              }
              count={countsByOptionId.get(option.id) ?? 0}
              htmlFor={`${messageId}-${option.id}`}
              key={option.id}
              label={option.label}
              selected={selectedOptionIds.includes(option.id)}
              showResponseCount={showResponseCounts}
            />
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2">
          {choiceOptions.map((option) => (
            <ChoiceOptionRow
              align={align}
              control={
                <Checkbox
                  aria-label={option.label}
                  checked={selectedOptionIds.includes(option.id)}
                  disabled={!canRespond || answered || submitting}
                  id={`${messageId}-${option.id}`}
                  onCheckedChange={(checked) =>
                    toggleMultipleOption(option.id, checked === true)
                  }
                />
              }
              count={countsByOptionId.get(option.id) ?? 0}
              htmlFor={`${messageId}-${option.id}`}
              key={option.id}
              label={option.label}
              selected={selectedOptionIds.includes(option.id)}
              showResponseCount={showResponseCounts}
            />
          ))}
        </div>
      )}
      {!answered && (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          <Button
            className="w-full"
            disabled={
              !canRespond || submitting || selectedOptionIds.length === 0
            }
            onClick={() => void submitResponse()}
            size="sm"
            type="button"
            variant="outline"
          >
            {submitting ? "提交中..." : "提交"}
          </Button>
        </div>
      )}
    </div>
  )
}

function ChoiceOptionRow({
  align,
  control,
  count,
  htmlFor,
  label,
  selected,
  showResponseCount,
}: {
  align: "start" | "end"
  control: React.ReactNode
  count: number
  htmlFor: string
  label: string
  selected: boolean
  showResponseCount: boolean
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-foreground/10 px-3 py-2 transition-colors",
        selected && "border-teal-500/50 bg-teal-500/10"
      )}
      htmlFor={htmlFor}
    >
      {control}
      <span className="min-w-0 flex-1 wrap-break-word">{label}</span>
      {showResponseCount && (
        <Badge
          className={cn(
            "shrink-0 tabular-nums",
            messageReactionChipToneClassName[align]
          )}
          variant="secondary"
        >
          {count}
        </Badge>
      )}
    </label>
  )
}

function TopicReplyPreview({
  onOpen,
  topic,
}: {
  onOpen?: () => void
  topic: NonNullable<ConversationPanelMessage["topic"]>
}) {
  const latestReplyTime = topic.recentReplies.at(-1)?.time ?? ""

  return (
    <div
      className="mt-3 w-120 max-w-full border-t border-foreground/10 pt-2"
      data-slot="topic-reply-preview"
    >
      {topic.recentReplies.length > 0 && (
        <>
          <button
            aria-label="查看话题最近回复"
            className="block w-full space-y-1.5 rounded-sm text-left transition-opacity outline-none hover:opacity-80 disabled:pointer-events-none"
            disabled={!onOpen}
            onClick={onOpen}
            type="button"
          >
            {topic.recentReplies.map((reply) => (
              <div className="flex min-w-0 items-center gap-2" key={reply.id}>
                <Avatar className="size-5 shrink-0 rounded-sm bg-background after:rounded-sm">
                  {reply.avatar && (
                    <AvatarImage
                      alt={reply.author}
                      className="rounded-sm"
                      src={reply.avatar}
                    />
                  )}
                  <AvatarFallback className="rounded-sm text-[9px]">
                    {getAvatarInitial(reply.author)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 truncate text-xs">
                  <span className="font-medium text-foreground/90">
                    {reply.author}
                  </span>
                  <span className="text-muted-foreground">
                    ：{reply.summary}
                  </span>
                </div>
              </div>
            ))}
          </button>
          <div className="my-3 border-t border-foreground/10" />
        </>
      )}
      <div className="flex w-full items-center justify-between gap-3">
        <button
          className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 transition-colors hover:text-teal-500 disabled:pointer-events-none dark:text-teal-400 dark:hover:text-teal-300"
          disabled={!onOpen}
          onClick={onOpen}
          type="button"
        >
          <MessagesSquare className="size-4" />
          查看话题
        </button>
        {latestReplyTime && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {latestReplyTime}
          </span>
        )}
      </div>
    </div>
  )
}

function MessageAvatar({
  fallback,
  fallbackClassName,
  message,
}: {
  fallback: React.ReactNode
  fallbackClassName?: string
  message: ConversationPanelMessage
}) {
  const avatar = (
    <Avatar className="mt-1 size-8 rounded-sm bg-muted after:rounded-sm">
      {message.avatar && (
        <AvatarImage
          alt={message.author}
          className="rounded-sm"
          src={message.avatar}
        />
      )}
      <AvatarFallback className={cn("rounded-sm", fallbackClassName)}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  )

  return <MessageAvatarProfile message={message}>{avatar}</MessageAvatarProfile>
}

function MessageAvatarProfile({
  children,
  message,
}: {
  children: React.ReactNode
  message: ConversationPanelMessage
}) {
  if (message.senderAppId) {
    return (
      <AppProfilePopover
        appId={message.senderAppId}
        fallbackProfile={message.senderAppProfile}
        triggerAriaLabel={`${message.author}资料`}
      >
        {children}
      </AppProfilePopover>
    )
  }

  return (
    <UserProfilePopover userId={message.senderUserId}>
      {children}
    </UserProfilePopover>
  )
}

type MessageBodyRendererProps = {
  body: ConversationPanelMessage["body"]
  collapseLongContent?: boolean
  currentUserId: string
  flushImage?: boolean
  mentionLabelResolver: MentionLabelResolver
  onReeditRevoked?: () => void
  roundVideoBottom?: boolean
}

export const MessageBodyRenderer = React.memo(function MessageBodyRenderer({
  body,
  collapseLongContent = false,
  currentUserId,
  flushImage = false,
  mentionLabelResolver,
  onReeditRevoked,
  roundVideoBottom = true,
}: MessageBodyRendererProps) {
  switch (body.type) {
    case "file":
      return <MessageAttachment file={body} />
    case "image":
      return (
        <ImageMessageBody
          body={body}
          currentUserId={currentUserId}
          flush={flushImage}
          mentionLabelResolver={mentionLabelResolver}
        />
      )
    case "video":
      return (
        <VideoMessageBody
          body={body}
          currentUserId={currentUserId}
          flush={flushImage}
          mentionLabelResolver={mentionLabelResolver}
          roundedBottom={roundVideoBottom}
        />
      )
    case "voice":
      return <MessageVoice voice={body} />
    case "link":
      return <MessageLink link={body} />
    case "card":
      return <MessageCard card={body} />
    case "chart":
      return (
        <MessageRenderErrorBoundary
          fallback={
            <span className="text-muted-foreground">暂不支持查看该消息</span>
          }
          resetKey={body}
        >
          <React.Suspense
            fallback={
              <div className="h-64 w-120 max-w-full animate-pulse rounded-sm bg-foreground/5" />
            }
          >
            <MessageChart chart={body} />
          </React.Suspense>
        </MessageRenderErrorBoundary>
      )
    case "markdown":
      return (
        <CollapsibleMessageContent
          enabled={collapseLongContent}
          variant="markdown"
        >
          <MessageMarkdown
            content={body.content}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
          />
        </CollapsibleMessageContent>
      )
    case "choice":
      return body.contentType === "markdown" ? (
        <MessageMarkdown
          content={body.content}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      ) : (
        <TextMessageBody
          content={body.content}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      )
    case "text":
      return (
        <CollapsibleMessageContent enabled={collapseLongContent} variant="text">
          <TextMessageBody
            content={body.content}
            currentUserId={currentUserId}
            mentionLabelResolver={mentionLabelResolver}
          />
        </CollapsibleMessageContent>
      )
    case "forward_bundle":
      return (
        <ForwardBundleMessage
          body={body}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver}
        />
      )
    case "revoked":
      return body.editableBody && onReeditRevoked ? (
        <span className="text-muted-foreground">
          <button
            className="cursor-pointer p-0 font-medium text-(--weui-link) transition-colors hover:text-(--weui-link) focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-(--weui-link)/40 focus-visible:outline-none"
            onClick={onReeditRevoked}
            type="button"
          >
            重新编辑
          </button>
          已撤回的消息
        </span>
      ) : (
        <span className="text-muted-foreground">该消息已被撤回</span>
      )
    case "unsupported":
      return <span className="text-muted-foreground">暂不支持查看该消息</span>
    case "system_event":
      return <span>{formatClientMessageBodySummary(body)}</span>
  }
}, areMessageBodyRendererPropsEqual)

function areMessageBodyRendererPropsEqual(
  previous: MessageBodyRendererProps,
  next: MessageBodyRendererProps
) {
  return (
    previous.body === next.body &&
    previous.collapseLongContent === next.collapseLongContent &&
    previous.currentUserId === next.currentUserId &&
    previous.flushImage === next.flushImage &&
    previous.onReeditRevoked === next.onReeditRevoked &&
    (previous.mentionLabelResolver === next.mentionLabelResolver ||
      !messageBodyUsesMentionLabels(next.body))
  )
}

function messageBodyUsesMentionLabels(
  body: ConversationPanelMessage["body"]
): boolean {
  if (
    body.type === "text" ||
    body.type === "markdown" ||
    body.type === "choice" ||
    body.type === "image" ||
    body.type === "video"
  ) {
    const content =
      body.type === "image" || body.type === "video"
        ? body.caption
        : body.content
    return Boolean(content?.includes("{(@"))
  }

  if (body.type === "forward_bundle") {
    return body.items.some((item) => messageBodyUsesMentionLabels(item.body))
  }

  return false
}

function ImageMessageBody({
  body,
  currentUserId,
  flush,
  mentionLabelResolver,
}: {
  body: Extract<ConversationPanelMessage["body"], { type: "image" }>
  currentUserId: string
  flush: boolean
  mentionLabelResolver: MentionLabelResolver
}) {
  const thumbnailFrame = getImageThumbnailFrame(body)

  return (
    <div
      className="max-w-[65vw] min-w-0"
      data-slot="image-message-body"
      style={{ width: thumbnailFrame.width }}
    >
      <MessageImage image={body} />
      {body.caption && (
        <div className={cn("min-w-0 pt-2", flush && "px-3 pb-3")}>
          {body.captionType === "markdown" ? (
            <MessageMarkdown
              content={body.caption}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
            />
          ) : (
            <TextMessageBody
              content={body.caption}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
            />
          )}
        </div>
      )}
    </div>
  )
}

function VideoMessageBody({
  body,
  currentUserId,
  flush,
  mentionLabelResolver,
  roundedBottom,
}: {
  body: Extract<ConversationPanelMessage["body"], { type: "video" }>
  currentUserId: string
  flush: boolean
  mentionLabelResolver: MentionLabelResolver
  roundedBottom: boolean
}) {
  return (
    <div className="max-w-[65vw] min-w-0" data-slot="video-message-body">
      <MessageVideo roundedBottom={roundedBottom} video={body} />
      {body.caption && (
        <div className={cn("min-w-0 pt-2", flush && "px-3 pb-3")}>
          {body.captionType === "markdown" ? (
            <MessageMarkdown
              content={body.caption}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
            />
          ) : (
            <TextMessageBody
              content={body.caption}
              currentUserId={currentUserId}
              mentionLabelResolver={mentionLabelResolver}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ForwardBundleMessage({
  body,
  currentUserId,
  mentionLabelResolver,
}: {
  body: Extract<ConversationPanelMessage["body"], { type: "forward_bundle" }>
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  const summary = formatClientMessageBodySummary(body)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="grid w-80 max-w-full cursor-pointer gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
        >
          <span className="flex min-w-0 items-center gap-3">
            <MessagesSquare
              aria-hidden="true"
              className="size-4.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 text-sm">聊天记录</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[80vh] grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>聊天记录</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain rounded-md border px-4">
          {body.items.map((item, index) => (
            <div
              className="border-b py-4 last:border-b-0"
              key={`${item.sentAt}-${index}`}
            >
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground/80">
                  {item.senderName}
                </span>
                <span className="shrink-0">
                  {formatForwardBundleItemTime(item.sentAt)}
                </span>
              </div>
              <ForwardBundleItemBody
                body={item.body}
                currentUserId={currentUserId}
                mentionLabelResolver={mentionLabelResolver}
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ForwardBundleItemBody({
  body,
  currentUserId,
  mentionLabelResolver,
}: {
  body: ConversationPanelMessage["body"]
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  return (
    <div
      className="w-full rounded-md bg-zinc-100 p-3 dark:bg-zinc-800"
      data-forward-bundle-item-body
    >
      <MessageBodyRenderer
        body={body}
        currentUserId={currentUserId}
        mentionLabelResolver={mentionLabelResolver}
      />
    </div>
  )
}

function formatForwardBundleItemTime(sentAt: string) {
  const date = new Date(sentAt)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const dateText = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
  }).format(date)
  const timeText = new Intl.DateTimeFormat("zh-CN", {
    timeStyle: "short",
  }).format(date)

  return `${dateText} ${timeText}`
}

function TextMessageBody({
  content,
  currentUserId,
  mentionLabelResolver,
}: {
  content: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  const parts = parseMentionTemplate(content, mentionLabelResolver)

  return (
    <span className="break-all whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <MessageTextWithLinks key={`text-${index}`} text={part.text} />
        ) : (
          <MentionTextPart
            key={`${part.targetType}-${part.id}-${index}`}
            currentUserId={currentUserId}
            part={part}
          />
        )
      )}
    </span>
  )
}

function MentionTextPart({
  currentUserId,
  part,
}: {
  currentUserId: string
  part: Extract<
    ReturnType<typeof parseMentionTemplate>[number],
    { type: "mention" }
  >
}) {
  const isCurrentUserMention =
    part.targetType === "all" ||
    (part.targetType === "user" && isSameUserId(part.id, currentUserId))
  const content = (
    <span className={getMentionTextClassName(isCurrentUserMention)}>
      {part.label}
    </span>
  )

  if (part.targetType !== "user") {
    if (part.targetType === "app") {
      return (
        <AppProfilePopover
          appId={part.id}
          fallbackProfile={{
            avatar: "",
            description: "",
            id: part.id,
            name: part.label.replace(/^@/, ""),
            online: false,
          }}
        >
          {content}
        </AppProfilePopover>
      )
    }

    return content
  }

  return <UserProfilePopover userId={part.id}>{content}</UserProfilePopover>
}

function getMentionTextClassName(isCurrentUserMention: boolean) {
  return isCurrentUserMention
    ? "mx-0.5 font-medium text-amber-600 hover:text-amber-700"
    : "mx-0.5 font-medium text-(--weui-link)"
}

function isSameUserId(userId: string | undefined, currentUserId: string) {
  return userId?.toLowerCase() === currentUserId.toLowerCase()
}
