import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { FlashIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { ContactProfileProvider } from "@/components/avatar/contact-profile-popover"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
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
import { AppRail, SectionPlaceholder, type AppSection } from "./components/app-navigation"
import { hasUnmutedUnreadConversations } from "./conversation-unread"
import { ClientAppDialog } from "../contacts/client-app-dialog"
import { ContactsPage } from "../contacts/contacts-page"
import { ChatHeader } from "./components/chat-header"
import { ConversationSidebar } from "./components/conversation-sidebar"
import { CreateGroupConversationDialog } from "./components/create-group-conversation-dialog"
import { ForwardMessageDialog } from "./components/forward-message-dialog"
import { MessageComposer } from "./components/message-composer"
import { MessageList } from "./components/message-list"
import { MessageSelectionToolbar } from "./components/message-selection-toolbar"
import { useAttachmentSender } from "./hooks/use-attachment-sender"
import { useChatData } from "./hooks/use-chat-data"
import { useConversationStatus } from "./hooks/use-conversation-status"
import { orderedForwardMessageIds, useMessageSelection } from "./hooks/use-message-selection"
import { SendFileMessageDialog } from "./send-file-message-dialog"
import { getDesktopMessageEditableBody, getDesktopMessageReplyAuthor } from "./message-actions"
import { SendChoiceMessageDialog } from "./send-choice-message-dialog"
import { SendChartMessageDialog } from "./send-chart-message-dialog"
import { SendMediaMessageDialog } from "./send-media-message-dialog"
import type {
  DesktopContactDirectory,
  DesktopMessage,
  DesktopMessageReplyTarget,
  LocalSearchResult,
  SendRichMessageBody,
} from "../../../shared/account-data"
import type { AuthUser, ServerCatalog } from "../../../shared/auth"
import type { ThemePreference } from "../../../shared/desktop"
import { normalizeSingleLinkMessageURL } from "../../../shared/message-link"
import {
  createDraftFromMessage,
  createDraftMentionTemplate,
  createMentionCandidates,
  insertDraftMention,
  syncDraftMentions,
  type DraftMention,
  type MentionCandidate,
} from "./conversation-mentions"

type ConversationDraft = {
  text: string
  mentions: DraftMention[]
  replyTarget: DesktopMessageReplyTarget | null
  markdownMode: boolean
}

type ForwardOperation = {
  sourceConversationId: string
  clientForwardId: string
  messageIds: string[]
  mode: "separate" | "merged"
}

export function ChatPage({
  targetId,
  serverUrl,
  userId,
  userName,
  userEmail,
  organizationName,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  onThemeChange,
  onSignOut,
  onUserUpdated,
  onRequestQuit,
  onCatalogChange,
  onRefresh,
  notificationTarget,
  onNotificationHandled,
}: {
  targetId: string
  serverUrl: string
  userId: string
  userName: string
  userEmail: string
  organizationName: string
  resolvedTheme: "light" | "dark"
  theme: ThemePreference
  catalog: ServerCatalog
  isPreview: boolean
  onThemeChange: (theme: ThemePreference) => void
  onSignOut: () => Promise<boolean>
  onUserUpdated: (user: AuthUser) => void
  onRequestQuit: () => void
  onCatalogChange: (catalog: ServerCatalog) => void
  onRefresh: () => void
  notificationTarget: { targetId: string; conversationId: string; messageId: string } | null
  onNotificationHandled: () => void
}) {
  const { showToast } = useAnimatedToast()
  const [activeSection, setActiveSection] = useState<AppSection>("chat")
  const [actionDialog, setActionDialog] = useState<"group" | "app" | null>(null)
  const [actionDirectory, setActionDirectory] = useState<DesktopContactDirectory | null>(null)
  const actionRequestRef = useRef(0)
  const [searchMessageTarget, setSearchMessageTarget] = useState<{
    conversationId: string
    messageId: string
  } | null>(null)
  const [draft, setDraft] = useState("")
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([])
  const [composerFocused, setComposerFocused] = useState(false)
  const [replyTarget, setReplyTarget] = useState<DesktopMessageReplyTarget | null>(null)
  const [markdownMode, setMarkdownMode] = useState(false)
  const [takingScreenshot, setTakingScreenshot] = useState(false)
  const capturingScreenshotRef = useRef(false)
  const [draftRevision, setDraftRevision] = useState(0)
  const [richDialog, setRichDialog] = useState<"choice" | "chart" | null>(null)
  const [createTopicMessage, setCreateTopicMessage] = useState<DesktopMessage | null>(null)
  const [forwardOperation, setForwardOperation] = useState<ForwardOperation | null>(null)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pendingComposerCursorRef = useRef<number | null>(null)
  const draftsRef = useRef(new Map<string, ConversationDraft>())
  const previousDraftKeyRef = useRef<string | null>(null)
  const locatingSearchRef = useRef<string | null>(null)
  const {
    conversations,
    messages,
    selected,
    selectedId,
    loadingConversations,
    loadingMessages,
    loadingBeforeMessages,
    pendingReactionKeys,
    revokingMessageIds,
    newMessageCount,
    hasMoreAfterMessages,
    messageGap,
    loadingGap,
    historyRef,
    setSelectedId,
    openTopicConversation,
    updateHistoryScrollPosition,
    scrollToLatestMessage,
    jumpToLocalMessage,
    loadAfterMessages,
    loadMessageGap,
    resolveMentionLabel,
    onlineContactKeys,
    setMessageReaction,
    setConversationPinned,
    setConversationMuted,
    dismissConversation,
    submitChoiceResponse,
    applySentMessages,
    sendTextMessage,
    createMessageTopic,
    revokeMessage,
    retryMessage,
    loadBeforeMessages,
  } = useChatData({ targetId, userId, userName, activeSection })
  const selection = useMessageSelection(`${targetId}:${selectedId ?? ""}`)
  useEffect(() => {
    setForwardOperation(null)
  }, [targetId, selectedId])
  useEffect(() => {
    if (activeSection !== "chat") {
      selection.cancel()
      setForwardOperation(null)
    }
  }, [activeSection, selection.cancel])
  const mentionCandidates = useMemo(
    () => createMentionCandidates(selected, conversations, resolveMentionLabel),
    [selected, conversations, resolveMentionLabel],
  )
  useEffect(() => {
    if (!window.desktop) return
    void window.desktop.setActiveConversation({
      targetId,
      conversationId: activeSection === "chat" ? (selected?.id ?? null) : null,
    })
    return () => {
      void window.desktop?.setActiveConversation({ targetId, conversationId: null })
    }
  }, [activeSection, selected?.id, targetId])
  useEffect(() => {
    if (!notificationTarget || notificationTarget.targetId !== targetId) return
    setActiveSection("chat")
    setSelectedId(notificationTarget.conversationId)
    setSearchMessageTarget({
      conversationId: notificationTarget.conversationId,
      messageId: notificationTarget.messageId,
    })
    onNotificationHandled()
  }, [notificationTarget, targetId, setSelectedId, onNotificationHandled])
  const conversationStatus = useConversationStatus({
    targetId,
    conversation: selected,
    draft,
    focused: activeSection === "chat" && composerFocused,
  })

  useEffect(() => {
    if (
      !searchMessageTarget ||
      activeSection !== "chat" ||
      selectedId !== searchMessageTarget.conversationId ||
      selected?.id !== selectedId ||
      loadingMessages
    ) {
      return
    }
    if (
      !messages.some(
        (message) =>
          message.conversationId === selectedId && message.id === searchMessageTarget.messageId,
      )
    ) {
      const key = `${selectedId}\0${searchMessageTarget.messageId}`
      if (locatingSearchRef.current !== key) {
        locatingSearchRef.current = key
        void jumpToLocalMessage(searchMessageTarget.messageId)
          .catch((error: unknown) => {
            if (locatingSearchRef.current !== key) return
            showToast({
              status: "error",
              title: error instanceof Error ? error.message : "无法定位消息",
            })
            setSearchMessageTarget((current) =>
              current?.conversationId === selectedId &&
              current.messageId === searchMessageTarget.messageId
                ? null
                : current,
            )
          })
          .finally(() => {
            if (locatingSearchRef.current === key) locatingSearchRef.current = null
          })
      }
      return
    }
    let clearHighlightTimer: number | undefined
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(
        historyRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
      ).find((element) => element.dataset.messageId === searchMessageTarget.messageId)
      if (!row) return
      row.scrollIntoView({ block: "center" })
      clearHighlightTimer = window.setTimeout(() => {
        setSearchMessageTarget((current) =>
          current?.messageId === searchMessageTarget.messageId ? null : current,
        )
      }, 2000)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (clearHighlightTimer !== undefined) window.clearTimeout(clearHighlightTimer)
    }
  }, [
    activeSection,
    historyRef,
    jumpToLocalMessage,
    loadingMessages,
    messages,
    searchMessageTarget,
    selectedId,
    selected?.id,
    showToast,
  ])

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const composer = composerRef.current
      if (!composer) return
      composer.focus()
      const cursor = pendingComposerCursorRef.current
      if (cursor !== null) {
        composer.setSelectionRange(cursor, cursor)
        pendingComposerCursorRef.current = null
      }
    })
  }, [])

  const captureScreenshot = useCallback(async () => {
    if (capturingScreenshotRef.current) return
    capturingScreenshotRef.current = true
    setTakingScreenshot(true)
    try {
      if (!window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.captureScreenshot()
      if (!result.ok) throw new Error(result.error.message)
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误"
      showToast({
        status: "error",
        title: "启动截图失败",
        description: detail,
        duration: 15_000,
        action: {
          label: "复制完整报错",
          onClick: () => {
            if (!window.desktop) return
            void window.desktop
              .copyText(detail)
              .then((result) => {
                showToast({
                  status: result.ok ? "success" : "error",
                  title: result.ok ? "已复制完整报错" : "复制报错失败",
                })
              })
              .catch(() => showToast({ status: "error", title: "复制报错失败" }))
          },
        },
      })
    } finally {
      capturingScreenshotRef.current = false
      setTakingScreenshot(false)
    }
  }, [showToast])

  const clearReplyTarget = useCallback(() => setReplyTarget(null), [])

  const {
    selectingFile,
    importingFile,
    importFile,
    sendingFile,
    fileDialogOpen,
    pendingFile,
    selectingMedia,
    sendingMedia,
    mediaCaption,
    pendingImage,
    pendingVideo,
    setMediaCaption,
    selectFile,
    sendPendingFile,
    selectMedia,
    sendPendingImage,
    sendPendingVideo,
    closeFileDialog,
    closeImageDialog,
    closeVideoDialog,
  } = useAttachmentSender({
    targetId,
    selected,
    replyToMessageId: replyTarget?.id,
    focusComposer,
    onMessages: applySentMessages,
    onReplyConsumed: clearReplyTarget,
  })

  const sendDraft = useCallback(() => {
    const content = createDraftMentionTemplate(draft, draftMentions).trim()
    if (!content) return
    const link = normalizeSingleLinkMessageURL(content)
    const bodyType = link ? "link" : markdownMode ? "markdown" : "text"
    setDraft("")
    setDraftMentions([])
    setReplyTarget(null)
    focusComposer()
    sendTextMessage(link ?? content, bodyType, replyTarget?.id)
  }, [draft, draftMentions, focusComposer, markdownMode, replyTarget, sendTextMessage])

  const changeDraft = useCallback(
    (value: string) => {
      setDraftMentions((current) => syncDraftMentions(current, draft, value))
      setDraft(value)
    },
    [draft],
  )

  const insertMention = useCallback(
    (candidate: MentionCandidate, start: number, end: number) => {
      const inserted = insertDraftMention(draft, draftMentions, candidate, start, end)
      setDraft(inserted.value)
      setDraftMentions(inserted.mentions)
      pendingComposerCursorRef.current = inserted.cursor
      focusComposer()
    },
    [draft, draftMentions, focusComposer],
  )

  const mentionMessageSender = useCallback(
    (candidate: MentionCandidate) => {
      const composer = composerRef.current
      const start = composer?.selectionStart ?? draft.length
      insertMention(candidate, start, composer?.selectionEnd ?? start)
    },
    [draft.length, insertMention],
  )

  const sendRichMessage = useCallback(
    async (body: SendRichMessageBody) => {
      if (!selectedId || !window.desktop) throw new Error("桌面服务暂不可用")
      const result = await window.desktop.accountData.sendRichMessage({
        targetId,
        conversationId: selectedId,
        body,
        replyToMessageId: replyTarget?.id,
      })
      if (!result.ok) throw new Error(result.error.message)
      applySentMessages(selectedId, result.data)
      clearReplyTarget()
      focusComposer()
    },
    [applySentMessages, clearReplyTarget, focusComposer, replyTarget, selectedId, targetId],
  )

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.nativeEvent.isComposing
      ) {
        return
      }
      event.preventDefault()
      sendDraft()
    },
    [sendDraft],
  )

  const confirmCreateTopic = useCallback(async () => {
    if (!createTopicMessage || creatingTopic) return
    setCreatingTopic(true)
    try {
      const result = await createMessageTopic(createTopicMessage)
      setCreateTopicMessage(null)
      showToast({
        status: "success",
        title: result.created ? "话题已创建" : "已打开现有话题",
      })
      openTopicConversation(result.conversation.id)
    } catch (error) {
      showToast({
        status: "error",
        title: "创建话题失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setCreatingTopic(false)
    }
  }, [createMessageTopic, createTopicMessage, creatingTopic, openTopicConversation, showToast])

  const reeditRevokedMessage = useCallback(
    (message: DesktopMessage) => {
      const editableBody = getDesktopMessageEditableBody(message)
      if (!editableBody) return
      const restored = createDraftFromMessage(editableBody.content, resolveMentionLabel)
      setReplyTarget(null)
      setDraft(restored.text)
      setDraftMentions(restored.mentions)
      setMarkdownMode(editableBody.type === "markdown")
      pendingComposerCursorRef.current = restored.text.length
      focusComposer()
    },
    [focusComposer, resolveMentionLabel],
  )

  const replyToMessage = useCallback(
    (message: DesktopMessage) => {
      const reply: DesktopMessageReplyTarget = {
        id: message.id,
        author: message.senderName || (message.isMine ? userName : "未知用户"),
        summary: message.content || "消息",
        ...(message.senderId && (message.senderType === "user" || message.senderType === "app")
          ? { senderId: message.senderId, senderType: message.senderType }
          : {}),
      }
      setReplyTarget({ ...reply, author: getDesktopMessageReplyAuthor(reply, resolveMentionLabel) })
      focusComposer()
    },
    [focusComposer, resolveMentionLabel, userName],
  )

  const insertExpression = useCallback(
    (value: string) => {
      const composer = composerRef.current
      const selectionStart = composer?.selectionStart ?? draft.length
      const selectionEnd = composer?.selectionEnd ?? selectionStart
      const nextDraft = `${draft.slice(0, selectionStart)}${value}${draft.slice(selectionEnd)}`
      pendingComposerCursorRef.current = selectionStart + value.length
      setDraftMentions((current) => syncDraftMentions(current, draft, nextDraft))
      setDraft(nextDraft)
    },
    [draft],
  )

  const draftKey = selectedId ? `${targetId}\0${selectedId}` : null
  useLayoutEffect(() => {
    const previousKey = previousDraftKeyRef.current
    if (previousKey === draftKey) return
    if (previousKey) {
      if (draft || draftMentions.length || replyTarget || markdownMode) {
        draftsRef.current.set(previousKey, {
          text: draft,
          mentions: draftMentions,
          replyTarget,
          markdownMode,
        })
      } else {
        draftsRef.current.delete(previousKey)
      }
    }
    const restored = draftKey ? draftsRef.current.get(draftKey) : undefined
    previousDraftKeyRef.current = draftKey
    setDraftRevision((revision) => revision + 1)
    setDraft(restored?.text ?? "")
    setDraftMentions(restored?.mentions ?? [])
    setReplyTarget(restored?.replyTarget ?? null)
    setMarkdownMode(restored?.markdownMode ?? false)
    pendingComposerCursorRef.current = null
    if (selectedId) focusComposer()
  }, [draft, draftKey, draftMentions, focusComposer, markdownMode, replyTarget, selectedId])

  const draftConversationIds = useMemo(() => {
    const ids = new Set<string>()
    const prefix = `${targetId}\0`
    for (const [key, saved] of draftsRef.current) {
      if (key.startsWith(prefix) && saved.text.trim()) ids.add(key.slice(prefix.length))
    }
    if (selectedId) {
      if (draft.trim()) ids.add(selectedId)
      else ids.delete(selectedId)
    }
    return ids
  }, [draft, draftKey, draftRevision, selectedId, targetId])

  const openProfileConversation = useCallback(
    async (type: "user" | "app", id: string) => {
      const result = await window.desktop!.accountData.openContactConversation({
        targetId,
        type,
        id,
      })
      if (!result.ok) throw new Error(result.error.message)
      setSelectedId(result.data.id)
      setActiveSection("chat")
    },
    [setSelectedId, targetId],
  )

  const selectSearchResult = useCallback(
    async (result: LocalSearchResult) => {
      if (result.kind === "message") {
        setSearchMessageTarget({ conversationId: result.conversationId, messageId: result.id })
        setSelectedId(result.conversationId)
        setActiveSection("chat")
        return
      }
      if (!window.desktop) return
      const conversation = await window.desktop.accountData.openContactConversation({
        targetId,
        type: result.kind === "contact" ? "user" : result.kind,
        id: result.id,
        joined: result.kind === "group" ? result.joined : undefined,
      })
      if (!conversation.ok) {
        showToast({ status: "error", title: conversation.error.message })
        return
      }
      setSearchMessageTarget(null)
      setSelectedId(conversation.data.id)
      setActiveSection("chat")
    },
    [setSelectedId, showToast, targetId],
  )

  const openActionDialog = useCallback(
    async (dialog: "group" | "app") => {
      if (!window.desktop) return
      const requestId = ++actionRequestRef.current
      setActionDirectory(null)
      if (dialog === "group") setActionDialog(dialog)
      try {
        const result = await window.desktop.accountData.getContacts(targetId)
        if (requestId !== actionRequestRef.current) return
        if (!result.ok) throw new Error(result.error.message)
        setActionDirectory(result.data)
        setActionDialog(dialog)
      } catch (error) {
        if (requestId !== actionRequestRef.current) return
        setActionDialog(null)
        showToast({
          status: "error",
          title: error instanceof Error ? error.message : "无法读取通讯录",
        })
      }
    },
    [showToast, targetId],
  )

  const closeActionDialog = useCallback(() => {
    actionRequestRef.current += 1
    setActionDialog(null)
    setActionDirectory(null)
  }, [])

  function openForwardOperation(messageIds: string[], mode: "separate" | "merged") {
    if (!selectedId || !messageIds.length || (mode === "merged" && messageIds.length < 2)) return
    setForwardOperation({
      sourceConversationId: selectedId,
      clientForwardId: crypto.randomUUID(),
      messageIds,
      mode,
    })
  }

  function toggleForwardSelection(message: DesktopMessage) {
    if (
      !selection.selected.has(message.id) &&
      selection.selected.size >= selection.maxSelectedMessages
    ) {
      showToast({ status: "warning", title: "一次最多选择 50 条消息" })
      return
    }
    selection.toggle(message)
  }

  async function submitForward(targetConversationIds: string[]) {
    if (!forwardOperation || !window.desktop) throw new Error("转发操作不可用")
    const result = await window.desktop.accountData.forwardMessages({
      targetId,
      sourceConversationId: forwardOperation.sourceConversationId,
      clientForwardId: forwardOperation.clientForwardId,
      messageIds: forwardOperation.messageIds,
      mode: forwardOperation.mode,
      targetConversationIds,
    })
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  return (
    <main className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <AppRail
        targetId={targetId}
        serverUrl={serverUrl}
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        resolvedTheme={resolvedTheme}
        theme={theme}
        catalog={catalog}
        isPreview={isPreview}
        activeSection={activeSection}
        hasUnreadMessages={hasUnmutedUnreadConversations(conversations)}
        onSectionChange={setActiveSection}
        onSignOut={onSignOut}
        onUserUpdated={onUserUpdated}
        onRequestQuit={onRequestQuit}
        onThemeChange={onThemeChange}
        onCatalogChange={onCatalogChange}
      />
      {activeSection === "chat" ? (
        <div className="grid min-w-0 flex-1 grid-cols-[19rem_minmax(0,1fr)]">
          <ConversationSidebar
            conversations={conversations}
            currentUserId={userId}
            draftConversationIds={draftConversationIds}
            loading={loadingConversations}
            selectedId={selectedId}
            targetId={targetId}
            resolvedTheme={resolvedTheme}
            mentionLabelResolver={resolveMentionLabel}
            onSetPinned={setConversationPinned}
            onSetMuted={setConversationMuted}
            onDismiss={dismissConversation}
            onSelect={setSelectedId}
            onCreateGroup={() => void openActionDialog("group")}
            onCreateApp={() => void openActionDialog("app")}
            onRefresh={onRefresh}
            onSelectSearchResult={selectSearchResult}
          />

          <section className="flex min-h-0 min-w-0 flex-col bg-card" aria-label="聊天区域">
            <ContactProfileProvider
              targetId={targetId}
              currentUserId={userId}
              currentUserName={userName}
              currentUserEmail={userEmail}
              theme={resolvedTheme}
              onOpenConversation={openProfileConversation}
            >
              {selected ? (
                <>
                  <ChatHeader
                    conversation={selected}
                    targetId={targetId}
                    resolvedTheme={resolvedTheme}
                    status={conversationStatus}
                    onlineContactKeys={onlineContactKeys}
                    currentUserId={userId}
                    onLocateMessage={async (messageId) => {
                      try {
                        const located = await jumpToLocalMessage(messageId)
                        if (located)
                          setSearchMessageTarget({ conversationId: selected.id, messageId })
                        return located
                      } catch (error) {
                        showToast({
                          status: "error",
                          title: error instanceof Error ? error.message : "无法定位消息",
                        })
                        return false
                      }
                    }}
                    onConversationRemoved={() =>
                      setSelectedId(conversations.find((item) => item.id !== selected.id)?.id ?? "")
                    }
                    onSetPinned={setConversationPinned}
                    onSetMuted={setConversationMuted}
                    onDismiss={dismissConversation}
                  />

                  <MessageList
                    messages={messages}
                    loading={loadingMessages}
                    loadingBefore={loadingBeforeMessages}
                    historyRef={historyRef}
                    targetId={targetId}
                    userId={userId}
                    userName={userName}
                    resolvedTheme={resolvedTheme}
                    conversationName={selected.name}
                    showChoiceResponseCounts={
                      selected.type === "group" || selected.type === "topic"
                    }
                    topicCreationEnabled={selected.type !== "topic" && selected.canSend !== false}
                    revokeEnabled={!selected.topic?.archived}
                    canModerateMessages={Boolean(selected.canModerateMessages)}
                    mentionLabelResolver={resolveMentionLabel}
                    mentionCandidates={
                      selected.canSend === false || selection.active ? [] : mentionCandidates
                    }
                    onMentionSender={mentionMessageSender}
                    pendingReactionKeys={pendingReactionKeys}
                    revokingMessageIds={revokingMessageIds}
                    highlightedMessageId={
                      searchMessageTarget?.conversationId === selected.id
                        ? searchMessageTarget.messageId
                        : null
                    }
                    newMessageCount={newMessageCount}
                    hasMoreAfterMessages={hasMoreAfterMessages}
                    messageGap={messageGap}
                    loadingGap={loadingGap}
                    onReachGap={() => void loadMessageGap()}
                    onViewportScroll={updateHistoryScrollPosition}
                    onScrollToBottom={scrollToLatestMessage}
                    onReachTop={() => {
                      if (!searchMessageTarget) void loadBeforeMessages()
                    }}
                    onReachBottom={() => {
                      if (!searchMessageTarget) void loadAfterMessages()
                    }}
                    onSetReaction={setMessageReaction}
                    onSubmitChoice={submitChoiceResponse}
                    onOpenTopic={openTopicConversation}
                    onCreateTopic={setCreateTopicMessage}
                    onReeditRevokedMessage={reeditRevokedMessage}
                    onReplyMessage={replyToMessage}
                    selectionActive={selection.active}
                    selectedMessageIds={selection.selected}
                    onForwardMessage={(message) => openForwardOperation([message.id], "separate")}
                    onStartMessageSelection={selection.start}
                    onToggleMessageSelection={toggleForwardSelection}
                    onRevokeMessage={revokeMessage}
                    onRetryMessage={retryMessage}
                  />

                  {selection.active ? (
                    <MessageSelectionToolbar
                      count={selection.selected.size}
                      onCancel={selection.cancel}
                      onForward={(mode) =>
                        openForwardOperation(orderedForwardMessageIds(selection.selected), mode)
                      }
                    />
                  ) : (
                    <MessageComposer
                      key={draftKey}
                      composerRef={composerRef}
                      draft={draft}
                      mentionCandidates={mentionCandidates}
                      targetId={targetId}
                      resolvedTheme={resolvedTheme}
                      replyTarget={replyTarget}
                      mentionLabelResolver={resolveMentionLabel}
                      markdownMode={markdownMode}
                      takingScreenshot={takingScreenshot}
                      selectingFile={selectingFile}
                      sendingFile={sendingFile}
                      selectingMedia={selectingMedia}
                      sendingMedia={sendingMedia}
                      importingFile={importingFile}
                      onCancelReply={() => {
                        clearReplyTarget()
                        focusComposer()
                      }}
                      onFiles={(files) => {
                        if (files.length !== 1) {
                          showToast({ status: "error", title: "请每次发送一个文件" })
                          return
                        }
                        void importFile(files[0])
                      }}
                      onDraftBlur={() => setComposerFocused(false)}
                      onDraftChange={changeDraft}
                      onInsertMention={insertMention}
                      onDraftFocus={() => setComposerFocused(true)}
                      onKeyDown={handleComposerKeyDown}
                      onMarkdownChange={(pressed) => {
                        setMarkdownMode(pressed)
                        focusComposer()
                      }}
                      onRestoreFocus={focusComposer}
                      onInsertExpression={insertExpression}
                      onSelectFile={selectFile}
                      onScreenshot={() => void captureScreenshot()}
                      onSelectMedia={(category) => void selectMedia(category)}
                      onSelectChoice={() => setRichDialog("choice")}
                      onSelectChart={() => setRichDialog("chart")}
                      onSend={sendDraft}
                    />
                  )}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xgui-background-2">
                  <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
                    <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
                  </span>
                </div>
              )}
            </ContactProfileProvider>
          </section>
        </div>
      ) : activeSection === "contacts" ? (
        <ContactsPage
          targetId={targetId}
          serverUrl={serverUrl}
          userId={userId}
          organizationName={organizationName}
          resolvedTheme={resolvedTheme}
          onOpenConversation={(conversationId) => {
            setSelectedId(conversationId)
            setActiveSection("chat")
          }}
          onCreateGroup={() => void openActionDialog("group")}
          onCreateApp={() => void openActionDialog("app")}
          onRefresh={onRefresh}
          onSelectSearchResult={selectSearchResult}
          mentionLabelResolver={resolveMentionLabel}
        />
      ) : (
        <SectionPlaceholder section={activeSection} />
      )}
      {actionDialog === "group" && (
        <CreateGroupConversationDialog
          targetId={targetId}
          currentUserId={userId}
          theme={resolvedTheme}
          contacts={actionDirectory?.users ?? []}
          apps={actionDirectory?.apps ?? []}
          loading={!actionDirectory}
          onClose={closeActionDialog}
          onCreated={(conversation) => {
            closeActionDialog()
            setSelectedId(conversation.id)
            setActiveSection("chat")
          }}
        />
      )}
      {actionDialog === "app" && actionDirectory && (
        <ClientAppDialog
          mode="create"
          targetId={targetId}
          serverUrl={serverUrl}
          currentUserId={userId}
          theme={resolvedTheme}
          users={actionDirectory.users}
          credentials={null}
          onClose={closeActionDialog}
          onChanged={() => undefined}
          onAvatarChanged={() => undefined}
        />
      )}
      {forwardOperation && (
        <ForwardMessageDialog
          conversations={conversations}
          targetId={targetId}
          theme={resolvedTheme}
          messageCount={forwardOperation.messageIds.length}
          onForward={submitForward}
          onComplete={selection.cancel}
          onClose={() => setForwardOperation(null)}
        />
      )}
      <AlertDialog
        open={Boolean(createTopicMessage)}
        onOpenChange={(open) => {
          if (!open && !creatingTopic) setCreateTopicMessage(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>创建话题</AlertDialogTitle>
            <AlertDialogDescription>
              将以这条消息作为起点创建一个独立话题，方便围绕它继续讨论。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creatingTopic}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={creatingTopic}
              onClick={(event) => {
                event.preventDefault()
                void confirmCreateTopic()
              }}
            >
              {creatingTopic && (
                <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
              )}
              确认创建
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SendMediaMessageDialog
        category="image"
        caption={mediaCaption}
        conversationName={pendingImage?.conversationName ?? ""}
        open={Boolean(pendingImage)}
        resourceUrl={pendingImage?.prepared.resourceUrl ?? ""}
        sending={sendingMedia === "image"}
        onCaptionChange={setMediaCaption}
        onConfirm={sendPendingImage}
        onOpenChange={(open) => {
          if (!open) closeImageDialog()
        }}
      />
      <SendMediaMessageDialog
        category="video"
        caption={mediaCaption}
        conversationName={pendingVideo?.conversationName ?? ""}
        open={Boolean(pendingVideo)}
        resourceUrl={pendingVideo?.selected.resourceUrl ?? ""}
        sending={sendingMedia === "video"}
        onCaptionChange={setMediaCaption}
        onConfirm={sendPendingVideo}
        onOpenChange={(open) => {
          if (!open) closeVideoDialog()
        }}
      />
      <SendChoiceMessageDialog
        key={`choice:${selectedId ?? ""}`}
        conversationName={selected?.name ?? ""}
        open={richDialog === "choice" && Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setRichDialog(null)
        }}
        onSend={sendRichMessage}
      />
      <SendChartMessageDialog
        key={`chart:${selectedId ?? ""}`}
        conversationName={selected?.name ?? ""}
        open={richDialog === "chart" && Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setRichDialog(null)
        }}
        onSend={sendRichMessage}
      />
      <SendFileMessageDialog
        conversationName={pendingFile?.conversationName ?? ""}
        file={pendingFile?.file ?? null}
        open={fileDialogOpen}
        sending={sendingFile}
        onConfirm={sendPendingFile}
        onOpenChange={(open) => {
          if (!open) closeFileDialog()
        }}
      />
    </main>
  )
}
