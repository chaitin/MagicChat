import * as React from "react"
import { Bot, Ellipsis, LoaderCircle, MessageSquareOff, X } from "lucide-react"
import { toast } from "sonner"

import { useLocale } from "@/components/locale-provider"

import {
  archiveConversationTopic,
  forwardConversationMessages,
  getConversationTopic,
  listConversationMessageChoiceSnapshots,
  listConversationMessageReactionSnapshots,
  normalizeConversationRemovedEventPayload,
  normalizeMessageUpdatedEventPayload,
  normalizeMessageReactionsUpdatedEventPayload,
  normalizeMessageChoiceUpdatedEventPayload,
  participateConversationTopic,
  type ClientMessageReaction,
  type ClientChoiceState,
  type MessageChoiceSnapshot,
  type MessageReactionSnapshot,
  type ClientMessage,
  type ClientUser,
  type ClientTopicDetail,
  type ClientTopicSourceMessage,
  type ContactApp,
  type ContactUser,
} from "@/lib/client-data-api"
import { getAvatarInitial } from "@/lib/avatar"
import { applyTopicSourceMessageUpdate, getClientDataErrorMessage } from "@/lib/client-data-state"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"
import { type MentionLabelResolver } from "@/lib/message-mentions"
import {
  getTopicSourceSenderProfile,
  isTopicSourceMessageSelectable,
} from "@/lib/topic-source-message"
import { createClientMessageId } from "@/lib/message-id"
import { useMessageSelection } from "@/hooks/use-message-selection"
import type {
  ConversationDraftMention,
  ConversationDraftReplyTarget,
} from "@/lib/conversation-drafts"
import {
  formatConversationMessageSummary,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import { cn } from "@/lib/utils"
import {
  ConversationPanel,
  type ConversationPanelForwardMode,
  type ConversationPanelMessage,
} from "@/components/conversation-panel"
import { ForwardMessageDialog } from "@/components/conversation/forward-message-dialog"
import { MessageBodyRenderer } from "@/components/conversation/conversation-message"
import {
  MessageActionMenu,
  MessageMoreActionsMenu,
  type MessageActionOptions,
} from "@/components/message-action-menu"
import {
  MessageReactionAddButton,
  MessageReactionChips,
} from "@/components/conversation/message-reactions"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
const emptyMentionLabelResolver: MentionLabelResolver = () => undefined
const emptyContactAppsById: ReadonlyMap<string, ContactApp> = new Map()

function isMessageSelectable(message: Pick<ClientMessage, "body">) {
  return (
    message.body.type !== "choice" &&
    message.body.type !== "revoked" &&
    message.body.type !== "unsupported" &&
    message.body.type !== "system_event"
  )
}

type TopicDrawerProps = {
  conversationId: string
  onOpenChange: (open: boolean) => void
  open: boolean
}

type TopicForwardOperation = {
  clientForwardId: string
  messageIds: string[]
  messageTypes: ClientMessage["body"]["type"][]
  mode: ConversationPanelForwardMode
  sourceConversationId: string
}

export function TopicDrawer(props: TopicDrawerProps) {
  return (
    <TopicDrawerContent
      key={`${props.conversationId}:${props.open ? "open" : "closed"}`}
      {...props}
    />
  )
}

function TopicDrawerContent({ conversationId, onOpenChange, open }: TopicDrawerProps) {
  const { t } = useLocale()
  const {
    contactApps,
    compactConversationMessages,
    consumeConversationMessageFocus,
    contacts,
    usersById = {},
    conversations,
    ensureConversationMessages,
    getConversation,
    getConversationMessageState,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    markConversationRead,
    me,
    mergeIncomingConversationMessage,
    refreshConversations,
    registerConversationMessageView,
    replaceWithLatestMessages,
    respondToChoice,
    revokeConversationMessage,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
    sendConversationVoice,
    setMessageReaction,
    updateMessageTopic,
  } = useClientData()
  const [detail, setDetail] = React.useState<ClientTopicDetail | null>(null)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(Boolean(open && conversationId))
  const [mutating, setMutating] = React.useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [draftMentions, setDraftMentions] = React.useState<ConversationDraftMention[]>([])
  const [replyTarget, setReplyTarget] = React.useState<ConversationDraftReplyTarget | null>(null)
  const [sourceReactionSnapshot, setSourceReactionSnapshot] =
    React.useState<MessageReactionSnapshot | null>(null)
  const [sourceChoiceSnapshot, setSourceChoiceSnapshot] =
    React.useState<MessageChoiceSnapshot | null>(null)
  const sourceChoiceRequestIdRef = React.useRef(0)
  const [forwardOperation, setForwardOperation] = React.useState<TopicForwardOperation | null>(null)
  const messageSelection = useMessageSelection(conversationId)
  const {
    maxSelectedMessages,
    selectedMessageIds,
    start: startSelectingMessage,
    toggle: toggleSelectedMessage,
  } = messageSelection
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
          setError(getClientDataErrorMessage(requestError, t("topic.loadFailed")))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [conversationId, ensureConversationMessages, open, t])

  const sourceConversationId = detail?.parentConversation.id ?? ""
  const sourceMessageId = detail?.sourceMessage.id ?? ""
  const sourceConversationCanSend = getConversation(sourceConversationId)?.canSend !== false
  const refreshSourceReactions = React.useCallback(async () => {
    if (!sourceConversationId || !sourceMessageId) return
    const [snapshot] = await listConversationMessageReactionSnapshots(sourceConversationId, [
      sourceMessageId,
    ])
    if (!snapshot) return
    setSourceReactionSnapshot((current) =>
      current && current.reactionVersion > snapshot.reactionVersion ? current : snapshot,
    )
  }, [sourceConversationId, sourceMessageId])

  const sourceIsChoice = detail?.sourceMessage.body.type === "choice"
  const refreshSourceChoice = React.useCallback(async () => {
    const requestId = ++sourceChoiceRequestIdRef.current
    if (!sourceIsChoice || !sourceConversationId || !sourceMessageId) {
      setSourceChoiceSnapshot(null)
      return
    }
    const [snapshot] = await listConversationMessageChoiceSnapshots(sourceConversationId, [
      sourceMessageId,
    ])
    if (requestId === sourceChoiceRequestIdRef.current && snapshot) {
      setSourceChoiceSnapshot(snapshot)
    }
  }, [sourceConversationId, sourceIsChoice, sourceMessageId])

  const handleSourceMessageUpdate = React.useCallback((message: ClientMessage) => {
    setDetail((current) => {
      if (
        !current ||
        current.parentConversation.id !== message.conversationId ||
        current.sourceMessage.id !== message.id
      ) {
        return current
      }
      return {
        ...current,
        sourceMessage: applyTopicSourceMessageUpdate(current.sourceMessage, message),
      }
    })
    if (message.body.type === "revoked") {
      setSourceReactionSnapshot(null)
    }
  }, [])

  React.useEffect(() => {
    if (!open || !sourceConversationId || !sourceMessageId) return
    let active = true
    void listConversationMessageReactionSnapshots(sourceConversationId, [sourceMessageId])
      .then(([snapshot]) => {
        if (!active || !snapshot) return
        setSourceReactionSnapshot((current) =>
          current && current.reactionVersion > snapshot.reactionVersion ? current : snapshot,
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, sourceConversationId, sourceMessageId])

  React.useEffect(() => {
    if (!open || !sourceIsChoice || !sourceConversationId || !sourceMessageId) return
    void refreshSourceChoice().catch(() => undefined)
    return () => {
      sourceChoiceRequestIdRef.current += 1
    }
  }, [open, refreshSourceChoice, sourceConversationId, sourceIsChoice, sourceMessageId])

  const detailConversation = detail?.conversation ?? null
  const listedConversation = detailConversation ? getConversation(detailConversation.id) : null
  const parentMessageState = detail
    ? getConversationMessageState(detail.parentConversation.id)
    : undefined
  const parentSourceTopic = parentMessageState?.messages.find(
    (message) => message.id === detail?.sourceMessage.id,
  )?.topic
  const baseConversation = listedConversation ?? detailConversation
  const synchronizedArchived =
    listedConversation?.topic?.archived ??
    parentSourceTopic?.archived ??
    detailConversation?.topic?.archived ??
    false
  const conversation = React.useMemo(() => {
    if (baseConversation?.topic && baseConversation.topic.archived !== synchronizedArchived) {
      return {
        ...baseConversation,
        topic: { ...baseConversation.topic, archived: synchronizedArchived },
      }
    }
    return baseConversation
  }, [baseConversation, synchronizedArchived])
  const messageState = conversation ? getConversationMessageState(conversation.id) : undefined
  const clientMessages = messageState?.messages ?? emptyMessages
  const messagesById = React.useMemo(
    () => new Map(clientMessages.map((message) => [message.id, message])),
    [clientMessages],
  )
  const contactsById = React.useMemo(
    () =>
      new Map([...contacts, ...Object.values(usersById)].map((contact) => [contact.id, contact])),
    [contacts, usersById],
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
    [appsById, contactsById, conversation?.members, me],
  )
  const messages = React.useMemo(
    () =>
      conversation
        ? clientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              conversation,
              me,
              contactsById,
              appsById,
              messagesById,
              mentionLabelResolver,
            ),
          )
        : [],
    [appsById, clientMessages, contactsById, conversation, me, mentionLabelResolver, messagesById],
  )
  const sourceMessageSelectable = Boolean(
    detail?.sourceMessage && isTopicSourceMessageSelectable(detail.sourceMessage),
  )
  const selectedForwardMessages = React.useMemo(() => {
    const selected: Array<Pick<ClientMessage, "body" | "id">> = []
    if (
      sourceMessageSelectable &&
      detail?.sourceMessage &&
      selectedMessageIds.has(detail.sourceMessage.id)
    ) {
      selected.push(detail.sourceMessage)
    }
    for (const message of clientMessages) {
      if (selectedMessageIds.has(message.id) && isMessageSelectable(message)) {
        selected.push(message)
      }
    }
    return selected
  }, [clientMessages, detail?.sourceMessage, selectedMessageIds, sourceMessageSelectable])
  const visibleMessageSelection = React.useMemo(
    () => ({
      active: messageSelection.active,
      selectedMessageIds: new Set(selectedForwardMessages.map((message) => message.id)),
    }),
    [messageSelection.active, selectedForwardMessages],
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
  }, [conversation, markConversationRead, messageState?.loaded, messageState?.viewMode, open])

  function updateDraft(value: string, mentions: ConversationDraftMention[]) {
    setDraft(value)
    setDraftMentions(mentions)
  }

  function replyToMessage(message: ConversationPanelMessage) {
    setReplyTarget({
      author: message.author,
      id: message.id,
      summary: formatConversationMessageSummary(message.body, mentionLabelResolver),
    })
  }

  async function sendMessage(contentOverride?: string) {
    if (!conversation || messageState?.sending) return false
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

  async function sendImage(image: File, caption: string, captionType: "text" | "markdown") {
    if (!conversation) return null
    const message = await sendConversationImage(conversation.id, image, {
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
      const nextConversation = await participateConversationTopic(targetConversationId)
      setDetail({
        ...detail,
        canParticipate: false,
        conversation: nextConversation,
      })
      toast.success(t("topic.joined"))
      void refreshConversations().catch(() => undefined)
    } catch (requestError) {
      toast.error(getClientDataErrorMessage(requestError, t("topic.joinFailed")))
    } finally {
      setMutating(false)
    }
  }

  async function archive() {
    if (!detail || mutating) return
    const targetConversationId = detail.conversation.id
    setMutating(true)
    try {
      const nextConversation = await archiveConversationTopic(targetConversationId)
      setDetail({
        ...detail,
        canArchive: false,
        canParticipate: false,
        conversation: nextConversation,
      })
      updateMessageTopic?.(detail.parentConversation.id, detail.sourceMessage.id, {
        archived: true,
        conversationId: targetConversationId,
      })
      setArchiveConfirmOpen(false)
      toast.success(t("topic.closed"))
      void refreshConversations().catch(() => undefined)
    } catch (requestError) {
      toast.error(getClientDataErrorMessage(requestError, t("topic.closeFailed")))
    } finally {
      setMutating(false)
    }
  }

  async function setSourceReaction(text: string, reacted: boolean) {
    if (!detail) return
    const snapshot = await setMessageReaction(
      detail.parentConversation.id,
      detail.sourceMessage.id,
      text,
      reacted,
    )
    setSourceReactionSnapshot((current) =>
      current && current.reactionVersion > snapshot.reactionVersion ? current : snapshot,
    )
  }

  function openForwardOperation(
    selected: Array<Pick<ClientMessage, "body" | "id">>,
    mode: ConversationPanelForwardMode,
  ) {
    if (
      !conversation ||
      selected.length === 0 ||
      selected.some((message) => !isMessageSelectable(message)) ||
      (mode === "merged" && selected.length < 2)
    ) {
      return
    }
    setForwardOperation({
      clientForwardId: createClientMessageId(),
      messageIds: selected.map((message) => message.id),
      messageTypes: selected.map((message) => message.body.type),
      mode,
      sourceConversationId: conversation.id,
    })
  }

  function forwardMessage(message: ConversationPanelMessage) {
    const clientMessage = messagesById.get(message.id)
    if (clientMessage && isMessageSelectable(clientMessage)) {
      openForwardOperation([clientMessage], "separate")
    }
  }

  function startMessageSelection(message: ConversationPanelMessage) {
    const clientMessage = messagesById.get(message.id)
    if (clientMessage && isMessageSelectable(clientMessage)) {
      startSelectingMessage(clientMessage.id)
    }
  }

  function toggleMessageSelection(message: ConversationPanelMessage) {
    const clientMessage = messagesById.get(message.id)
    if (!clientMessage || !isMessageSelectable(clientMessage)) return
    toggleSelectableMessage(clientMessage.id)
  }

  function toggleSelectableMessage(messageId: string) {
    const selected = selectedMessageIds.has(messageId)
    if (!selected && selectedMessageIds.size >= maxSelectedMessages) {
      toast.warning(t("topic.maxSelected", { count: maxSelectedMessages }))
      return
    }
    toggleSelectedMessage(messageId)
  }

  function forwardTopicSource(message: ClientTopicSourceMessage) {
    if (sourceMessageSelectable && detail?.sourceMessage.id === message.id) {
      openForwardOperation([message], "separate")
    }
  }

  function startTopicSourceSelection(message: ClientTopicSourceMessage) {
    if (sourceMessageSelectable && detail?.sourceMessage.id === message.id) {
      startSelectingMessage(message.id)
    }
  }

  async function submitForwardOperation(targetConversationIds: string[]) {
    if (!forwardOperation) throw new Error(t("topic.forwardMissing"))
    if (forwardOperation.messageTypes.includes("choice")) {
      throw new Error(t("topic.cannotForward"))
    }
    const result = await forwardConversationMessages(forwardOperation.sourceConversationId, {
      clientForwardId: forwardOperation.clientForwardId,
      messageIds: forwardOperation.messageIds,
      mode: forwardOperation.mode,
      targetConversationIds,
    })
    for (const target of result.results) {
      if (target.status !== "sent") continue
      for (const message of target.messages) mergeIncomingConversationMessage(message)
    }
    return result
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
          {sourceConversationId && sourceMessageId && (
            <>
              <TopicSourceMessageSync
                conversationId={sourceConversationId}
                messageId={sourceMessageId}
                onUpdate={handleSourceMessageUpdate}
              />
              <TopicSourceReactionSync
                conversationId={sourceConversationId}
                messageId={sourceMessageId}
                onUpdate={refreshSourceReactions}
              />
              {sourceIsChoice && (
                <TopicSourceChoiceSync
                  conversationId={sourceConversationId}
                  messageId={sourceMessageId}
                  onUpdate={refreshSourceChoice}
                />
              )}
            </>
          )}
        </>
      )}
      <SheetContent
        className="min-h-0 gap-0 overflow-hidden p-0 data-[side=right]:w-[80vw] data-[side=right]:sm:max-w-400"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">{t("topic.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("topic.description")}</SheetDescription>
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t("topic.loading")}
          </div>
        ) : error || !conversation ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
            <span>{error || t("topic.notFound")}</span>
            <Button onClick={() => onOpenChange(false)} variant="secondary">
              {t("topic.close")}
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
                  <Button aria-label={t("topic.close.aria")} size="icon-sm" variant="ghost">
                    <X className="size-4" />
                  </Button>
                </SheetClose>
              </>
            }
            historyError={messageState?.error ?? null}
            onRetryHistory={() => ensureConversationMessages(conversation.id)}
            historyFocus={messageState?.focus ?? null}
            historyLoading={Boolean(messageState && !messageState.loaded && !messageState.error)}
            historyLoadingAfter={Boolean(messageState?.loadingAfter)}
            historyLoadingBefore={Boolean(messageState?.loadingBefore)}
            historyMode={messageState?.viewMode === "history"}
            historyPendingLatestMessageCount={messageState?.pendingLatestMessageCount ?? 0}
            historyHeader={
              <TopicSourceBanner
                appsById={appsById}
                reactionConversationId={sourceConversationId}
                currentUserId={me.id}
                currentUser={me}
                mentionLabelResolver={mentionLabelResolver}
                onForward={forwardTopicSource}
                onMultiSelect={startTopicSourceSelection}
                onSetReaction={conversation.canSend === false ? undefined : setSourceReaction}
                onRespondToChoice={
                  sourceIsChoice && sourceConversationCanSend && respondToChoice
                    ? async (optionIds) => {
                        await respondToChoice(sourceConversationId, sourceMessageId, optionIds)
                        await refreshSourceChoice()
                      }
                    : undefined
                }
                reactions={sourceReactionSnapshot?.reactions}
                selected={Boolean(
                  detail?.sourceMessage &&
                  visibleMessageSelection.selectedMessageIds.has(detail.sourceMessage.id),
                )}
                selectionMode={visibleMessageSelection.active}
                showChoiceResponseCounts={conversation.topic?.parentConversationType === "group"}
                sourceChoice={sourceChoiceSnapshot?.choice}
                sourceChoiceStatus={sourceChoiceSnapshot?.status}
                sourceMessage={detail?.sourceMessage}
                onToggleSelected={(message) => toggleSelectableMessage(message.id)}
                usersById={usersById}
              />
            }
            mentionLabelResolver={mentionLabelResolver}
            messages={messages}
            messageSelection={visibleMessageSelection}
            onCancelMessageSelection={messageSelection.cancel}
            onCancelReply={() => setReplyTarget(null)}
            onCompactMessages={() => compactConversationMessages?.(conversation.id)}
            onConsumeHistoryFocus={(focus) =>
              consumeConversationMessageFocus(conversation.id, focus)
            }
            onRegisterMessageView={registerConversationMessageView}
            onDraftChange={updateDraft}
            onForwardMessage={forwardMessage}
            onForwardSelectedMessages={(mode) =>
              openForwardOperation(selectedForwardMessages, mode)
            }
            onLoadAfterMessages={() => loadAfterConversationMessages(conversation.id)}
            onLoadBeforeMessages={() => loadBeforeConversationMessages(conversation.id)}
            onReturnToLatestMessages={() => replaceWithLatestMessages(conversation.id)}
            onReplyToMessage={replyToMessage}
            onStartMessageSelection={startMessageSelection}
            onRevokeMessage={(message) =>
              void revokeConversationMessage(conversation.id, message.id).catch((requestError) =>
                toast.error(getClientDataErrorMessage(requestError, t("topic.revokeFailed"))),
              )
            }
            onSetMessageReaction={async (message, text, reacted) => {
              await setMessageReaction(conversation.id, message.id, text, reacted)
            }}
            onToggleMessageSelection={toggleMessageSelection}
            onRichTextModeChange={setRichTextMode}
            onSendFile={sendFile}
            onSendImage={sendImage}
            onSendMessage={sendMessage}
            onSendVoice={sendVoice}
            readOnlyFooter={
              detail?.canParticipate &&
              conversation.canSend !== false &&
              !conversation.topic?.participating &&
              !conversation.topic?.archived ? (
                <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3">
                  <span className="text-sm text-muted-foreground">{t("topic.joinHint")}</span>
                  <Button disabled={mutating} onClick={() => void participate()} type="button">
                    {mutating && <LoaderCircle className="size-4 animate-spin" />}
                    {t("topic.join")}
                  </Button>
                </div>
              ) : undefined
            }
            readOnly={conversation.topic?.archived || conversation.canSend === false}
            readOnlyReason={
              conversation.canSend === false && !conversation.topic?.archived
                ? conversation.topic?.parentConversationType === "app"
                  ? t("topic.noAccess")
                  : t("topic.cannotSend")
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
      {forwardOperation && (
        <ForwardMessageDialog
          conversations={conversations}
          messageCount={forwardOperation.messageIds.length}
          onComplete={messageSelection.cancel}
          onForward={submitForwardOperation}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setForwardOperation(null)
          }}
          open
        />
      )}
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
    [conversationId, onRemoved, parentConversationId, subscribeRealtimeEvent],
  )

  return null
}

export function TopicSourceReactionSync({
  conversationId,
  messageId,
  onUpdate,
}: {
  conversationId: string
  messageId: string
  onUpdate: () => Promise<void>
}) {
  const { subscribeRealtimeEvent } = useRealtime()

  React.useEffect(
    () =>
      subscribeRealtimeEvent("message.reactions_updated", (payload) => {
        try {
          const event = normalizeMessageReactionsUpdatedEventPayload(payload)
          if (event.conversationId === conversationId && event.messageId === messageId) {
            void onUpdate().catch(() => undefined)
          }
        } catch {
          // Ignore malformed realtime events. The websocket remains usable.
        }
      }),
    [conversationId, messageId, onUpdate, subscribeRealtimeEvent],
  )

  return null
}

export function TopicSourceMessageSync({
  conversationId,
  messageId,
  onUpdate,
}: {
  conversationId: string
  messageId: string
  onUpdate: (message: ClientMessage) => void
}) {
  const { subscribeRealtimeEvent } = useRealtime()

  React.useEffect(
    () =>
      subscribeRealtimeEvent("message.updated", (payload) => {
        try {
          const message = normalizeMessageUpdatedEventPayload(payload)
          if (message.conversationId === conversationId && message.id === messageId) {
            onUpdate(message)
          }
        } catch {
          // Ignore malformed realtime events. The websocket remains usable.
        }
      }),
    [conversationId, messageId, onUpdate, subscribeRealtimeEvent],
  )

  return null
}

export function TopicSourceChoiceSync({
  conversationId,
  messageId,
  onUpdate,
}: {
  conversationId: string
  messageId: string
  onUpdate: () => Promise<void>
}) {
  const { subscribeRealtimeEvent } = useRealtime()
  React.useEffect(
    () =>
      subscribeRealtimeEvent("message.choice_updated", (payload) => {
        try {
          const event = normalizeMessageChoiceUpdatedEventPayload(payload)
          if (event.conversationId === conversationId && event.messageId === messageId) {
            void onUpdate().catch(() => undefined)
          }
        } catch {
          // Ignore malformed realtime events. The websocket remains usable.
        }
      }),
    [conversationId, messageId, onUpdate, subscribeRealtimeEvent],
  )
  return null
}

export function TopicArchiveAction({ conversationId }: { conversationId: string }) {
  const { t } = useLocale()
  const { getConversation, refreshConversations, updateMessageTopic } = useClientData()
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
      updateMessageTopic?.(currentDetail.parentConversation.id, currentDetail.sourceMessage.id, {
        archived: true,
        conversationId,
      })
      setDetail({
        ...currentDetail,
        canArchive: false,
        canParticipate: false,
      })
      setConfirmOpen(false)
      toast.success(t("topic.closed"))
      void refreshConversations().catch(() => undefined)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("topic.closeFailed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TopicArchiveMenu disabled={saving} onSelect={() => setConfirmOpen(true)} />
      <TopicArchiveConfirmDialog
        onConfirm={() => void archive()}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        saving={saving}
      />
    </>
  )
}

function TopicArchiveMenu({ disabled, onSelect }: { disabled: boolean; onSelect: () => void }) {
  const { t } = useLocale()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("topic.moreActions")}
          disabled={disabled}
          size="icon-sm"
          title={t("topic.moreActions")}
          type="button"
          variant="ghost"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem disabled={disabled} onSelect={onSelect} variant="destructive">
          <MessageSquareOff />
          {t("topic.closeDiscussion")}
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
  const { t } = useLocale()
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen)
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("topic.closeConfirm")}</AlertDialogTitle>
          <AlertDialogDescription>{t("topic.closeDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>{t("topic.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            variant="destructive"
          >
            {saving && <LoaderCircle className="size-4 animate-spin" />}
            {t("topic.confirmClose")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TopicSourceBanner({
  appsById,
  conversationId,
  currentUserId,
  currentUser,
  mentionLabelResolver,
  onForward,
  onMultiSelect,
  onSetReaction,
  onRespondToChoice,
  onSourceMessageLoaded,
  onToggleSelected,
  reactionConversationId,
  reactions = [],
  selected = false,
  selectionMode = false,
  showChoiceResponseCounts = false,
  sourceMessage,
  sourceChoice,
  sourceChoiceStatus,
  usersById,
}: {
  appsById?: ReadonlyMap<string, ContactApp>
  conversationId?: string
  currentUserId: string
  currentUser?: Pick<ClientUser, "avatar" | "id" | "name" | "nickname">
  mentionLabelResolver?: MentionLabelResolver
  onForward?: (message: ClientTopicSourceMessage) => void
  onMultiSelect?: (message: ClientTopicSourceMessage) => void
  onSetReaction?: (text: string, reacted: boolean) => Promise<unknown>
  onRespondToChoice?: (optionIds: string[]) => Promise<void>
  onSourceMessageLoaded?: (message: ClientTopicSourceMessage) => void
  onToggleSelected?: (message: ClientTopicSourceMessage) => void
  reactionConversationId?: string
  reactions?: ClientMessageReaction[]
  selected?: boolean
  selectionMode?: boolean
  showChoiceResponseCounts?: boolean
  sourceMessage?: ClientTopicSourceMessage
  sourceChoice?: ClientChoiceState | null
  sourceChoiceStatus?: "active" | "deleted" | "revoked"
  usersById?: Readonly<Record<string, ContactUser>>
}) {
  const { t } = useLocale()
  const [fetchedSource, setFetchedSource] = React.useState<ClientTopicSourceMessage | null>(null)
  const loadedSource = sourceMessage ?? fetchedSource

  React.useEffect(() => {
    if (sourceMessage) return
    if (!conversationId) return
    let active = true
    void getConversationTopic(conversationId)
      .then((value) => {
        if (active) setFetchedSource(value.sourceMessage)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [conversationId, sourceMessage])

  React.useEffect(() => {
    if (loadedSource) onSourceMessageLoaded?.(loadedSource)
  }, [loadedSource, onSourceMessageLoaded])

  if (!loadedSource) return null
  const renderedSource = loadedSource

  const choiceUnavailable =
    loadedSource.body.type === "choice" &&
    (sourceChoiceStatus === "revoked" || sourceChoiceStatus === "deleted")
  const selectable = !choiceUnavailable && isTopicSourceMessageSelectable(loadedSource)
  const hasMessageActions = Boolean(onForward || onMultiSelect)
  const canAddReaction = Boolean(
    onSetReaction && !choiceUnavailable && loadedSource.body.type !== "revoked",
  )
  const messageActionOptions: MessageActionOptions = {
    copyDisabled: true,
    onForward: onForward ? () => onForward(loadedSource) : undefined,
    onMultiSelect: onMultiSelect ? () => onMultiSelect(loadedSource) : undefined,
  }

  function handleSelectionClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!selectionMode || !selectable || !onToggleSelected) return
    if (event.target instanceof Element && event.target.closest("[data-slot=checkbox]")) return
    event.preventDefault()
    event.stopPropagation()
    onToggleSelected(renderedSource)
  }

  const fromCurrentUser =
    loadedSource.sender.type === "user" && loadedSource.sender.id === currentUserId
  const sender = getTopicSourceSenderProfile(
    loadedSource.sender,
    currentUser,
    usersById ?? {},
    appsById ?? emptyContactAppsById,
  )
  const avatar = (
    <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
      {sender.avatar && (
        <AvatarImage alt={sender.name} className="rounded-sm" src={sender.avatar} />
      )}
      <AvatarFallback
        className={cn("rounded-sm", fromCurrentUser && "bg-primary text-primary-foreground")}
      >
        {loadedSource.sender.type === "app" ? (
          <Bot className="size-4" />
        ) : fromCurrentUser ? (
          t("topic.me")
        ) : (
          getAvatarInitial(sender.name)
        )}
      </AvatarFallback>
    </Avatar>
  )

  const messageBubble = (
    <div
      className={cn(
        "max-w-full min-w-0 rounded-md p-3 text-sm leading-relaxed shadow-sm",
        fromCurrentUser
          ? "bg-primary/10 text-foreground dark:bg-primary/15"
          : "bg-zinc-100 text-foreground dark:bg-zinc-800",
      )}
      data-message-action-trigger={
        !selectionMode && selectable && hasMessageActions ? "" : undefined
      }
      data-testid="topic-source-message-bubble"
    >
      {loadedSource.replyTo && <TopicSourceMessageReplyReference replyTo={loadedSource.replyTo} />}
      {choiceUnavailable ? (
        <span className="text-muted-foreground">
          {sourceChoiceStatus === "revoked" ? t("topic.revoked") : t("topic.deleted")}
        </span>
      ) : (
        <MessageBodyRenderer
          body={loadedSource.body}
          choice={sourceChoice ?? undefined}
          currentUserId={currentUserId}
          mentionLabelResolver={mentionLabelResolver ?? emptyMentionLabelResolver}
          messageId={loadedSource.id}
          onRespondToChoice={onRespondToChoice}
          showChoiceResponseCounts={showChoiceResponseCounts}
        />
      )}
      {!selectionMode &&
        !choiceUnavailable &&
        loadedSource.body.type !== "revoked" &&
        reactions.length > 0 && (
          <div className="mt-2">
            <MessageReactionChips
              align={fromCurrentUser ? "end" : "start"}
              canAdd
              conversationId={reactionConversationId ?? conversationId ?? ""}
              enabled
              messageId={loadedSource.id}
              onSetReaction={onSetReaction}
              reactions={reactions}
            />
          </div>
        )}
    </div>
  )
  const renderedMessageBubble =
    selectionMode || !selectable || !hasMessageActions ? (
      messageBubble
    ) : (
      <MessageActionMenu {...messageActionOptions}>{messageBubble}</MessageActionMenu>
    )

  return (
    <div
      className={cn(
        "group/message-row relative rounded-md transition-colors",
        selectionMode && "px-3 py-2 pl-11",
        selected && "bg-primary/5",
      )}
      data-conversation-message-id={loadedSource.id}
      data-message-selection-row
      onClickCapture={handleSelectionClick}
    >
      {selectionMode && (
        <Checkbox
          aria-label={t(selected ? "topic.deselect" : "topic.select", {
            name: sender.name,
          })}
          checked={selected}
          className="absolute top-4 left-3"
          disabled={!selectable}
          onCheckedChange={() => onToggleSelected?.(loadedSource)}
        />
      )}
      <div className={cn("flex gap-3", fromCurrentUser ? "justify-end" : "justify-start")}>
        {!fromCurrentUser && avatar}
        <div
          className={cn(
            "flex max-w-[min(70%,64rem)] flex-col gap-1",
            fromCurrentUser ? "items-end" : "items-start",
          )}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{sender.name}</span>
            <span>{formatTopicSourceTime(loadedSource.createdAt)}</span>
          </div>
          <div
            className={cn(
              "flex max-w-full items-end gap-1.5",
              fromCurrentUser && "flex-row-reverse",
            )}
            data-slot="message-bubble-line"
          >
            {renderedMessageBubble}
            {!selectionMode && (canAddReaction || (selectable && hasMessageActions)) && (
              <div
                className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/message-row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
                data-slot="message-hover-actions"
              >
                {canAddReaction && onSetReaction && (
                  <MessageReactionAddButton
                    align={fromCurrentUser ? "end" : "start"}
                    onSetReaction={onSetReaction}
                  />
                )}
                {selectable && hasMessageActions && (
                  <MessageMoreActionsMenu
                    {...messageActionOptions}
                    align={fromCurrentUser ? "end" : "start"}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        {fromCurrentUser && avatar}
      </div>
    </div>
  )
}

function TopicSourceMessageReplyReference({
  replyTo,
}: {
  replyTo: NonNullable<ClientTopicSourceMessage["replyTo"]>
}) {
  return (
    <div className="mb-2 border-l-2 border-foreground/20 pl-2 text-xs">
      <div className="truncate font-medium text-foreground/80">{replyTo.sender.name}</div>
      <div className="line-clamp-2 text-muted-foreground">{replyTo.summary}</div>
    </div>
  )
}

function formatTopicSourceTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function normalizeSingleLinkMessageURL(content: string) {
  if (!content || /\s/.test(content)) return null
  const candidate = content.toLowerCase().startsWith("www.") ? `https://${content}` : content
  try {
    const url = new URL(candidate)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}
