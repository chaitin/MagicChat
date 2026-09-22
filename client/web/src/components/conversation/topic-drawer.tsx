import * as React from "react"
import { Ellipsis, LoaderCircle, MessageSquareOff, X } from "lucide-react"
import { toast } from "sonner"

import {
  archiveConversationTopic,
  getConversationTopic,
  normalizeConversationRemovedEventPayload,
  participateConversationTopic,
  type ClientMessage,
  type ImageCaptionType,
  type ClientTopicDetail,
} from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"
import type {
  ConversationDraftMention,
  ConversationDraftReplyTarget,
} from "@/lib/conversation-drafts"
import {
  formatConversationMessageSummary,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import {
  ConversationPanel,
  type ConversationPanelMessage,
} from "@/components/conversation-panel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"

const emptyMessages: ClientMessage[] = []
type TopicDrawerProps = {
  conversationId: string
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function TopicDrawer(props: TopicDrawerProps) {
  return (
    <TopicDrawerContent
      key={`${props.conversationId}:${props.open ? "open" : "closed"}`}
      {...props}
    />
  )
}

function TopicDrawerContent({
  conversationId,
  onOpenChange,
  open,
}: TopicDrawerProps) {
  const {
    compactConversationMessages,
    consumeConversationMessageFocus,
    contactApps,
    contacts,
    ensureConversationMessages,
    getConversation,
    getConversationMessageState,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    markConversationRead,
    me,
    registerConversationMessageView,
    respondToChoice,
    refreshConversations,
    returnToLatestConversationMessages,
    revokeConversationMessage,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
    sendConversationVideo,
    sendConversationVoice,
    setMessageReaction,
    updateMessageTopic,
    usersById,
  } = useClientData()
  const [detail, setDetail] = React.useState<ClientTopicDetail | null>(null)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(Boolean(open && conversationId))
  const [mutating, setMutating] = React.useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [draftMentions, setDraftMentions] = React.useState<
    ConversationDraftMention[]
  >([])
  const [replyTarget, setReplyTarget] =
    React.useState<ConversationDraftReplyTarget | null>(null)
  const [richTextMode, setRichTextMode] = React.useState(false)
  React.useEffect(() => {
    if (!open || !conversationId) {
      return
    }
    let active = true
    void getConversationTopic(conversationId)
      .then((value) => {
        if (!active) return
        setDetail(value)
        ensureConversationMessages(value.conversation.id)
      })
      .catch((requestError) => {
        if (active) {
          setError(getClientDataErrorMessage(requestError, "加载话题失败"))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [conversationId, ensureConversationMessages, open])

  const detailConversation = detail?.conversation ?? null
  const listedConversation = detailConversation
    ? getConversation(detailConversation.id)
    : null
  const parentMessageState = detail
    ? getConversationMessageState(detail.parentConversation.id)
    : undefined
  const parentSourceTopic = parentMessageState?.messages.find(
    (message) => message.id === detail?.sourceMessage.id
  )?.topic
  const baseConversation = listedConversation ?? detailConversation
  const synchronizedArchived =
    listedConversation?.topic?.archived ??
    parentSourceTopic?.archived ??
    detailConversation?.topic?.archived ??
    false
  const conversation = React.useMemo(() => {
    if (
      baseConversation?.topic &&
      baseConversation.topic.archived !== synchronizedArchived
    ) {
      return {
        ...baseConversation,
        topic: { ...baseConversation.topic, archived: synchronizedArchived },
      }
    }
    return baseConversation
  }, [baseConversation, synchronizedArchived])
  const compactTopicMessages = React.useCallback(() => {
    compactConversationMessages(conversation?.id ?? "")
  }, [compactConversationMessages, conversation?.id])
  const messageState = conversation
    ? getConversationMessageState(conversation.id)
    : undefined
  const clientMessages = messageState?.messages ?? emptyMessages
  const historyNavigation = React.useMemo(
    () =>
      conversation && messageState
        ? {
            focus: messageState.focus,
            loadingAfter: messageState.loadingAfter,
            onFocusHandled: (requestKey: number) =>
              consumeConversationMessageFocus(conversation.id, requestKey),
            onLoadAfterMessages: () =>
              loadAfterConversationMessages(conversation.id),
            onReturnToLatest: () =>
              returnToLatestConversationMessages(conversation.id),
            pendingLatestMessageCount: messageState.pendingLatestMessageCount,
            viewMode: messageState.viewMode,
          }
        : undefined,
    [
      conversation,
      consumeConversationMessageFocus,
      loadAfterConversationMessages,
      messageState,
      returnToLatestConversationMessages,
    ]
  )
  const messagesById = React.useMemo(
    () => new Map(clientMessages.map((message) => [message.id, message])),
    [clientMessages]
  )
  const contactsById = React.useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  )
  const appsById = React.useMemo(() => {
    const result = new Map<string, (typeof contactApps)[number]>()
    for (const app of contactApps) {
      result.set(app.id, app)
      result.set(app.name, app)
    }
    return result
  }, [contactApps])
  const mentionLabelResolver = React.useMemo(
    () =>
      createConversationMentionLabelResolver({
        appsById,
        contactsById,
        conversationMembers: conversation?.members,
        currentUser: me,
      }),
    [appsById, contactsById, conversation?.members, me]
  )
  const messages = React.useMemo(
    () =>
      conversation
        ? clientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              conversation,
              me,
              usersById,
              appsById,
              messagesById,
              mentionLabelResolver
            )
          )
        : [],
    [
      appsById,
      clientMessages,
      conversation,
      me,
      mentionLabelResolver,
      messagesById,
      usersById,
    ]
  )

  React.useEffect(() => {
    if (
      !open ||
      !conversation ||
      !conversation.topic?.participating ||
      !messageState?.loaded ||
      messageState.viewMode === "history" ||
      conversation.lastReadSeq >= conversation.lastMessageSeq
    ) {
      return
    }
    void markConversationRead(conversation.id).catch(() => undefined)
  }, [conversation, markConversationRead, messageState, open])

  function updateDraft(value: string, mentions: ConversationDraftMention[]) {
    setDraft(value)
    setDraftMentions(mentions)
  }

  function replyToMessage(message: ConversationPanelMessage) {
    setReplyTarget({
      author: message.author,
      id: message.id,
      summary: formatConversationMessageSummary(
        message.body,
        mentionLabelResolver
      ),
    })
  }

  async function sendMessage(contentOverride?: string) {
    if (!conversation) return false
    const content = (contentOverride ?? draft).trim()
    if (!content) return false
    const link = normalizeSingleLinkMessageURL(content)
    const send = link
      ? sendConversationLink
      : richTextMode
        ? sendConversationMarkdown
        : sendConversationText
    const message = await send(conversation.id, link ?? content, {
      replyToMessageId: replyTarget?.id,
    })
    if (!message) return false
    setReplyTarget(null)
    return true
  }

  async function sendFile(file: File) {
    if (!conversation) return null
    const message = await sendConversationFile(conversation.id, file, {
      replyToMessageId: replyTarget?.id,
    })
    if (message) setReplyTarget(null)
    return message
  }

  async function sendImage(
    image: File,
    caption: string,
    captionType: ImageCaptionType
  ) {
    if (!conversation) return null
    const message = await sendConversationImage(conversation.id, image, {
      caption,
      captionType,
      replyToMessageId: replyTarget?.id,
    })
    if (message) setReplyTarget(null)
    return message
  }

  async function sendVideo(
    video: File,
    caption: string,
    captionType: ImageCaptionType
  ) {
    if (!conversation) return null
    const message = await sendConversationVideo(conversation.id, video, {
      caption,
      captionType,
      replyToMessageId: replyTarget?.id,
    })
    if (message) setReplyTarget(null)
    return message
  }

  async function sendVoice(voice: VoiceMessageRecording) {
    if (!conversation) return null
    const message = await sendConversationVoice(conversation.id, voice, {
      replyToMessageId: replyTarget?.id,
    })
    if (message) setReplyTarget(null)
    return message
  }

  async function participate() {
    if (!detail || mutating) return
    const targetConversationId = detail.conversation.id
    setMutating(true)
    try {
      const nextConversation =
        await participateConversationTopic(targetConversationId)
      setDetail({
        ...detail,
        canParticipate: false,
        conversation: nextConversation,
      })
      toast.success("已参与话题")
      void refreshConversations().catch(() => undefined)
    } catch (requestError) {
      toast.error(getClientDataErrorMessage(requestError, "参与话题失败"))
    } finally {
      setMutating(false)
    }
  }

  async function archive() {
    if (!detail || mutating) return
    const targetConversationId = detail.conversation.id
    setMutating(true)
    try {
      const nextConversation =
        await archiveConversationTopic(targetConversationId)
      setDetail({
        ...detail,
        canArchive: false,
        canParticipate: false,
        conversation: nextConversation,
      })
      updateMessageTopic?.(
        detail.parentConversation.id,
        detail.sourceMessage.id,
        { archived: true, conversationId: targetConversationId }
      )
      setArchiveConfirmOpen(false)
      toast.success("话题已关闭")
      void refreshConversations().catch(() => undefined)
    } catch (requestError) {
      toast.error(getClientDataErrorMessage(requestError, "关闭话题失败"))
    } finally {
      setMutating(false)
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {open && (
        <>
          <TopicRemovalSync
            conversationId={conversationId}
            onRemoved={() => onOpenChange(false)}
            parentConversationId={detail?.parentConversation.id}
          />
        </>
      )}
      <SheetContent
        className="min-h-0 gap-0 overflow-hidden p-0 data-[side=right]:w-[80vw] data-[side=right]:sm:max-w-400"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">话题</SheetTitle>
        <SheetDescription className="sr-only">
          查看并参与当前消息创建的话题
        </SheetDescription>
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在加载话题
          </div>
        ) : error || !conversation ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
            <span>{error || "话题不存在"}</span>
            <Button onClick={() => onOpenChange(false)} variant="secondary">
              关闭
            </Button>
          </div>
        ) : (
          <ConversationPanel
            conversation={conversation}
            currentUserId={me.id}
            draft={draft}
            draftMentions={draftMentions}
            headerActions={
              <>
                {detail?.canArchive &&
                  conversation.canSend !== false &&
                  !conversation.topic?.archived && (
                    <TopicArchiveMenu
                      disabled={mutating}
                      onSelect={() => setArchiveConfirmOpen(true)}
                    />
                  )}
                <SheetClose asChild>
                  <Button aria-label="关闭话题" size="icon-sm" variant="ghost">
                    <X className="size-4" />
                  </Button>
                </SheetClose>
              </>
            }
            historyError={messageState?.error ?? null}
            historyLoading={Boolean(
              messageState && !messageState.loaded && !messageState.error
            )}
            historyLoadingBefore={Boolean(messageState?.loadingBefore)}
            historyNavigation={historyNavigation}
            mentionLabelResolver={mentionLabelResolver}
            messages={messages}
            onCancelReply={() => setReplyTarget(null)}
            onCompactMessages={compactTopicMessages}
            onRegisterMessageView={registerConversationMessageView}
            onDraftChange={updateDraft}
            onLoadBeforeMessages={() =>
              loadBeforeConversationMessages(conversation.id)
            }
            onReplyToMessage={replyToMessage}
            onRevokeMessage={(message) =>
              void revokeConversationMessage(conversation.id, message.id).catch(
                (requestError) =>
                  toast.error(
                    getClientDataErrorMessage(requestError, "撤回消息失败")
                  )
              )
            }
            onSetMessageReaction={async (message, text, reacted) => {
              await setMessageReaction(
                conversation.id,
                message.id,
                text,
                reacted
              )
            }}
            onRespondToChoice={(message, optionIds) =>
              respondToChoice(conversation.id, message.id, optionIds)
            }
            onRichTextModeChange={setRichTextMode}
            onSendFile={sendFile}
            onSendImage={sendImage}
            onSendMessage={sendMessage}
            onSendVideo={sendVideo}
            onSendVoice={sendVoice}
            readOnlyFooter={
              detail?.canParticipate &&
              conversation.canSend !== false &&
              !conversation.topic?.participating &&
              !conversation.topic?.archived ? (
                <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
                  <span className="text-sm text-muted-foreground">
                    参与后可发言，并在会话列表中看到该话题
                  </span>
                  <Button
                    disabled={mutating}
                    onClick={() => void participate()}
                    type="button"
                  >
                    {mutating && (
                      <LoaderCircle className="size-4 animate-spin" />
                    )}
                    参与话题
                  </Button>
                </div>
              ) : undefined
            }
            readOnly={
              conversation.topic?.archived || conversation.canSend === false
            }
            readOnlyReason={
              conversation.canSend === false && !conversation.topic?.archived
                ? conversation.topic?.parentConversationType === "app"
                  ? "你当前无权直接使用此应用"
                  : "当前会话不能发送消息"
                : undefined
            }
            replyTarget={replyTarget}
            richTextMode={richTextMode}
            sending={Boolean(messageState?.sending)}
          />
        )}
      </SheetContent>
      <TopicArchiveConfirmDialog
        onConfirm={() => void archive()}
        onOpenChange={setArchiveConfirmOpen}
        open={archiveConfirmOpen}
        saving={mutating}
      />
    </Sheet>
  )
}

function TopicRemovalSync({
  conversationId,
  onRemoved,
  parentConversationId,
}: {
  conversationId: string
  onRemoved: () => void
  parentConversationId?: string
}) {
  const { subscribeRealtimeEvent } = useRealtime()

  React.useEffect(
    () =>
      subscribeRealtimeEvent("conversation.removed", (payload) => {
        try {
          const event = normalizeConversationRemovedEventPayload(payload)
          if (
            event.conversationId === conversationId ||
            event.conversationId === parentConversationId
          ) {
            onRemoved()
          }
        } catch {
          // Ignore malformed realtime events. The websocket remains usable.
        }
      }),
    [conversationId, onRemoved, parentConversationId, subscribeRealtimeEvent]
  )

  return null
}

export function TopicArchiveAction({
  conversationId,
}: {
  conversationId: string
}) {
  const { getConversation, refreshConversations, updateMessageTopic } =
    useClientData()
  const [detail, setDetail] = React.useState<ClientTopicDetail | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => {
    let active = true
    void getConversationTopic(conversationId)
      .then((value) => {
        if (active) setDetail(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [conversationId])

  if (!detail?.canArchive || getConversation(conversationId)?.topic?.archived) {
    return null
  }

  async function archive() {
    const currentDetail = detail
    if (!currentDetail) return
    setSaving(true)
    try {
      await archiveConversationTopic(conversationId)
      updateMessageTopic?.(
        currentDetail.parentConversation.id,
        currentDetail.sourceMessage.id,
        { archived: true, conversationId }
      )
      setDetail({
        ...currentDetail,
        canArchive: false,
        canParticipate: false,
      })
      setConfirmOpen(false)
      toast.success("话题已关闭")
      void refreshConversations().catch(() => undefined)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "关闭话题失败"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TopicArchiveMenu
        disabled={saving}
        onSelect={() => setConfirmOpen(true)}
      />
      <TopicArchiveConfirmDialog
        onConfirm={() => void archive()}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        saving={saving}
      />
    </>
  )
}

function TopicArchiveMenu({
  disabled,
  onSelect,
}: {
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多操作"
          disabled={disabled}
          size="icon-sm"
          title="更多操作"
          type="button"
          variant="ghost"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          disabled={disabled}
          onSelect={onSelect}
          variant="destructive"
        >
          <MessageSquareOff />
          关闭讨论
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TopicArchiveConfirmDialog({
  onConfirm,
  onOpenChange,
  open,
  saving,
}: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  saving: boolean
}) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen)
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认关闭讨论</AlertDialogTitle>
          <AlertDialogDescription>
            关闭后仍可查看话题，但无法继续发言，其他人也无法再参与。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            variant="destructive"
          >
            {saving && <LoaderCircle className="size-4 animate-spin" />}
            确认关闭
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function normalizeSingleLinkMessageURL(content: string) {
  if (!content || /\s/.test(content)) return null
  const candidate = content.toLowerCase().startsWith("www.")
    ? `https://${content}`
    : content
  try {
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}
