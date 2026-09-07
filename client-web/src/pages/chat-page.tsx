import * as React from "react"
import { LoaderCircle } from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import { useClientData } from "@/lib/client-data-context"
import { useConversationDrafts } from "@/hooks/use-conversation-drafts"
import { useConversationStatus } from "@/hooks/use-conversation-status"
import { useMessageSelection } from "@/hooks/use-message-selection"
import {
  createConversationTopic,
  forwardConversationMessages,
  getConversationTopic,
  type ClientConversation,
  type ImageCaptionType,
  type ClientMessage,
  type ClientMessageSearchResult,
  type ClientTopicSourceMessage,
  type ContactApp,
  type ContactUser,
} from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import type { DirectorySearchItem } from "@/lib/local-search"
import { createClientMessageId } from "@/lib/message-id"
import {
  clearLastConversationId,
  readLastConversationId,
  writeLastConversationId,
} from "@/lib/last-conversation"
import {
  emptyConversationDraft,
  type ConversationDraftMention,
} from "@/lib/conversation-drafts"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import { isTopicSourceMessageSelectable } from "@/lib/topic-source-message"
import {
  formatConversationMessageSummary,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"
import { FriendManagementDialog } from "@/components/contacts/friend-management-dialog"
import { CreateGroupConversationDialog } from "@/components/conversation/create-group-conversation-dialog"
import { ForwardMessageDialog } from "@/components/conversation/forward-message-dialog"
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import { ConversationTopicsDialog } from "@/components/conversation/conversation-topics-dialog"
import {
  TopicArchiveAction,
  TopicDrawer,
} from "@/components/conversation/topic-drawer"
import { TopicSourceBanner } from "@/components/conversation/topic-source-banner"
import {
  ConversationPanel,
  type ConversationPanelForwardMode,
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
import { SidebarProvider } from "@/components/ui/sidebar"

const emptyClientMessages: ClientMessage[] = []

type ForwardOperation = {
  clientForwardId: string
  messageIds: string[]
  mode: ConversationPanelForwardMode
  sourceConversationId: string
}

type CreateTopicOperation = {
  conversationId: string
  message: ConversationPanelMessage
}

type DirectoryConversationActions = {
  joinGroupConversation: (groupId: string) => Promise<ClientConversation>
  openAppConversation: (appId: string) => Promise<ClientConversation>
  openDirectConversation: (userId: string) => Promise<ClientConversation>
  restoreConversation: (conversationId: string) => Promise<ClientConversation>
}

function openDirectoryItemConversation(
  item: DirectorySearchItem,
  actions: DirectoryConversationActions
) {
  if (item.type === "user") {
    return actions.openDirectConversation(item.id)
  }
  if (item.type === "app") {
    return actions.openAppConversation(item.id)
  }
  return item.joined
    ? actions.restoreConversation(item.id)
    : actions.joinGroupConversation(item.id)
}

function getDirectoryItemOpenError(item: DirectorySearchItem) {
  if (item.type === "user") {
    return "无法发起单聊"
  }
  if (item.type === "app") {
    return "无法发起应用会话"
  }
  return item.joined ? "无法打开群聊" : "无法加入群聊"
}

function normalizeSingleLinkMessageURL(content: string) {
  const value = content.trim()
  if (!value || /\s/.test(value)) {
    return null
  }

  const linkCandidate = value.toLowerCase().startsWith("www.")
    ? `https://${value}`
    : value

  try {
    const url = new URL(linkCandidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }
    if (!url.hostname) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

export function ChatPage() {
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId?: string }>()
  const {
    acceptFriendRequest,
    cancelFriendRequest,
    contactApps,
    contactGroups,
    contacts,
    conversations,
    compactConversationMessages,
    consumeConversationMessageFocus,
    createGroupConversation,
    createFriendRequest,
    dismissConversation,
    ensureUsers,
    ensureConversationMessages,
    focusConversationMessage,
    getConversation,
    getConversationMessageState,
    getLatestCachedMessage,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    markConversationRead,
    me,
    mergeIncomingConversationMessage,
    registerConversationMessageView,
    joinGroupConversation,
    incomingFriendRequests,
    openAppConversation,
    openDirectConversation,
    outgoingFriendRequests,
    rejectFriendRequest,
    respondToChoice,
    refreshContacts,
    refreshConversations,
    revokeConversationMessage,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
    sendConversationVoice,
    setConversationPinned,
    setConversationMuted,
    setMessageReaction,
    setForegroundConversationId,
    restoreConversation,
    returnToLatestConversationMessages,
    updateMessageTopic,
    usersById,
  } = useClientData()
  const {
    clearConversationDraft,
    drafts,
    flushDrafts,
    updateConversationDraft,
  } = useConversationDrafts(me.id)
  const [richTextMode, setRichTextMode] = React.useState(false)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] =
    React.useState(false)
  const [friendManagementOpen, setFriendManagementOpen] = React.useState(false)
  const [forwardOperation, setForwardOperation] =
    React.useState<ForwardOperation | null>(null)
  const [createTopicOperation, setCreateTopicOperation] =
    React.useState<CreateTopicOperation | null>(null)
  const [creatingTopic, setCreatingTopic] = React.useState(false)
  const [topicDrawerConversationId, setTopicDrawerConversationId] =
    React.useState("")
  const [loadedTopicSource, setLoadedTopicSource] = React.useState<{
    conversationId: string
    message: ClientTopicSourceMessage
  } | null>(null)
  React.useEffect(
    () => () => setForegroundConversationId?.(""),
    [setForegroundConversationId]
  )
  const requestedConversationId = conversationId ?? ""
  const storedConversationId = React.useMemo(
    () => (requestedConversationId ? "" : readLastConversationId(me.id)),
    [me.id, requestedConversationId]
  )
  const storedConversation = storedConversationId
    ? getConversation(storedConversationId)
    : null
  const resolvedConversationId =
    requestedConversationId || storedConversation?.id || ""

  const activeConversation = React.useMemo(
    () =>
      resolvedConversationId ? getConversation(resolvedConversationId) : null,
    [getConversation, resolvedConversationId]
  )

  const activeConversationId = activeConversation?.id ?? ""
  const activeConversationType = activeConversation?.type
  const conversationStatus = useConversationStatus({
    conversationId: activeConversationId,
    supported:
      activeConversationType === "direct" || activeConversationType === "app",
  })
  const compactActiveConversationMessages = React.useCallback(() => {
    compactConversationMessages(activeConversationId)
  }, [activeConversationId, compactConversationMessages])
  const openTopicDrawer = React.useCallback(
    (nextConversationId: string) => {
      setTopicDrawerConversationId(nextConversationId)
      setForegroundConversationId?.(nextConversationId)
    },
    [setForegroundConversationId]
  )
  const closeTopicDrawer = React.useCallback(() => {
    setTopicDrawerConversationId("")
    setForegroundConversationId?.("")
  }, [setForegroundConversationId])
  const requestCreateTopic = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (!activeConversationId || activeConversationType === "topic") {
        return
      }
      setCreateTopicOperation({
        conversationId: activeConversationId,
        message,
      })
    },
    [activeConversationId, activeConversationType]
  )
  const messageSelection = useMessageSelection(activeConversationId)
  const {
    maxSelectedMessages,
    selectedMessageIds,
    start: startSelectingMessage,
    toggle: toggleSelectedMessage,
  } = messageSelection
  const activeDraft = drafts[activeConversationId] ?? emptyConversationDraft
  const draft = activeDraft.text
  const replyTarget = activeDraft.replyTarget
  const activeMessageState = activeConversationId
    ? getConversationMessageState(activeConversationId)
    : undefined
  const activeConversationHasUnreadProgress = Boolean(
    activeConversation &&
    (activeConversation.unreadCount > 0 ||
      activeConversation.lastReadSeq < activeConversation.lastMessageSeq)
  )
  const historyLoading = Boolean(
    activeConversation &&
    activeMessageState &&
    !activeMessageState.loaded &&
    !activeMessageState.error
  )
  const activeHistoryNavigation = React.useMemo(
    () =>
      activeMessageState
        ? {
            focus: activeMessageState.focus,
            loadingAfter: activeMessageState.loadingAfter,
            onFocusHandled: (requestKey: number) =>
              consumeConversationMessageFocus(activeConversationId, requestKey),
            onLoadAfterMessages: () =>
              loadAfterConversationMessages(activeConversationId),
            onReturnToLatest: () =>
              returnToLatestConversationMessages(activeConversationId),
            pendingLatestMessageCount:
              activeMessageState.pendingLatestMessageCount,
            viewMode: activeMessageState.viewMode,
          }
        : undefined,
    [
      activeConversationId,
      activeMessageState,
      consumeConversationMessageFocus,
      loadAfterConversationMessages,
      returnToLatestConversationMessages,
    ]
  )
  const activeConversationReadOnlyReason =
    activeConversation?.canSend === false && !activeConversation.topic?.archived
      ? activeConversation.type === "app" ||
        activeConversation.topic?.parentConversationType === "app"
        ? "你当前无权直接使用此应用"
        : "当前会话不能发送消息"
      : undefined
  const activeClientMessages =
    activeMessageState?.messages ?? emptyClientMessages
  const activeClientMessagesById = React.useMemo(
    () => new Map(activeClientMessages.map((message) => [message.id, message])),
    [activeClientMessages]
  )
  const activeClientMessagesByIdRef = React.useRef(activeClientMessagesById)
  React.useEffect(() => {
    activeClientMessagesByIdRef.current = activeClientMessagesById
  }, [activeClientMessagesById])
  const contactsById = React.useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  )
  const contactAppsByLookup = React.useMemo(() => {
    const appsByLookup = new Map<string, ContactApp>()

    for (const app of contactApps) {
      appsByLookup.set(app.id, app)
      appsByLookup.set(app.name, app)
    }

    return appsByLookup
  }, [contactApps])
  const activeMentionLabelResolver = React.useMemo(
    () =>
      createConversationMentionLabelResolver({
        appsById: contactAppsByLookup,
        contactsById,
        conversationMembers: activeConversation?.members,
        currentUser: {
          id: me.id,
          name: me.name,
          nickname: me.nickname,
        },
      }),
    [
      activeConversation?.members,
      contactAppsByLookup,
      contactsById,
      me.id,
      me.name,
      me.nickname,
    ]
  )
  const activeMentionLabelResolverRef = React.useRef(activeMentionLabelResolver)
  React.useEffect(() => {
    activeMentionLabelResolverRef.current = activeMentionLabelResolver
  }, [activeMentionLabelResolver])
  const activeConversationOnline = activeConversation
    ? getConversationOnlineStatus(
        activeConversation,
        me.id,
        contactsById,
        contactAppsByLookup
      )
    : undefined
  const activeMessages = React.useMemo(
    () =>
      activeConversation
        ? activeClientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              activeConversation,
              me,
              usersById,
              contactAppsByLookup,
              activeClientMessagesById,
              activeMentionLabelResolver
            )
          )
        : [],
    [
      activeClientMessages,
      activeClientMessagesById,
      activeConversation,
      activeMentionLabelResolver,
      contactAppsByLookup,
      usersById,
      me,
    ]
  )
  const activeTopicSource =
    loadedTopicSource?.conversationId === activeConversationId
      ? loadedTopicSource.message
      : null
  const activeTopicSourceSelectable = Boolean(
    activeTopicSource && isTopicSourceMessageSelectable(activeTopicSource)
  )
  const selectedForwardMessageIds = React.useMemo(() => {
    const messageIds: string[] = []
    if (
      activeTopicSourceSelectable &&
      activeTopicSource &&
      selectedMessageIds.has(activeTopicSource.id)
    ) {
      messageIds.push(activeTopicSource.id)
    }
    for (const message of activeClientMessages) {
      if (
        selectedMessageIds.has(message.id) &&
        message.body.type !== "revoked" &&
        message.body.type !== "unsupported" &&
        message.body.type !== "system_event"
      ) {
        messageIds.push(message.id)
      }
    }
    return messageIds
  }, [
    activeClientMessages,
    activeTopicSource,
    activeTopicSourceSelectable,
    selectedMessageIds,
  ])
  const visibleMessageSelection = React.useMemo(
    () => ({
      active: messageSelection.active,
      selectedMessageIds: new Set(selectedForwardMessageIds),
    }),
    [messageSelection.active, selectedForwardMessageIds]
  )

  React.useEffect(() => {
    if (requestedConversationId || !storedConversationId) {
      return
    }

    if (!storedConversation) {
      clearLastConversationId(me.id)
      return
    }

    navigate(`/chat/${encodeURIComponent(storedConversation.id)}`, {
      replace: true,
    })
  }, [
    me.id,
    navigate,
    requestedConversationId,
    storedConversation,
    storedConversationId,
  ])

  React.useEffect(() => {
    if (activeConversationId) {
      writeLastConversationId(me.id, activeConversationId)
    }
  }, [activeConversationId, me.id])

  const setDraft = React.useCallback(
    (nextDraft: string, nextMentions: ConversationDraftMention[]) => {
      updateConversationDraft(activeConversationId, (currentDraft) => ({
        ...currentDraft,
        mentions: nextMentions,
        text: nextDraft,
      }))
    },
    [activeConversationId, updateConversationDraft]
  )

  React.useEffect(() => {
    if (
      !activeConversationId ||
      activeMessageState?.loaded ||
      activeMessageState?.loading ||
      activeMessageState?.error
    ) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) ensureConversationMessages(activeConversationId)
    })
    return () => {
      active = false
    }
  }, [
    activeConversationId,
    activeMessageState?.error,
    activeMessageState?.loaded,
    activeMessageState?.loading,
    ensureConversationMessages,
  ])

  React.useEffect(() => {
    if (
      !activeConversationId ||
      !activeConversationHasUnreadProgress ||
      activeMessageState?.viewMode === "history"
    ) {
      return
    }

    function markActiveConversationRead() {
      if (document.visibilityState !== "visible") {
        return
      }

      void markConversationRead(activeConversationId).catch(() => undefined)
    }

    markActiveConversationRead()
    const interval = window.setInterval(markActiveConversationRead, 20_000)

    function handleVisibilityChange() {
      markActiveConversationRead()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [
    activeConversationId,
    activeConversationHasUnreadProgress,
    activeMessageState?.viewMode,
    markConversationRead,
  ])

  const loadBeforeMessages = React.useCallback(() => {
    if (!activeConversationId) {
      return
    }

    loadBeforeConversationMessages(activeConversationId)
  }, [activeConversationId, loadBeforeConversationMessages])

  const clearReplyTarget = React.useCallback(() => {
    updateConversationDraft(activeConversationId, (currentDraft) => ({
      ...currentDraft,
      replyTarget: null,
    }))
  }, [activeConversationId, updateConversationDraft])

  const replyToMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      updateConversationDraft(activeConversationId, (currentDraft) => ({
        ...currentDraft,
        replyTarget: {
          id: message.id,
          author: message.author,
          summary: formatConversationMessageSummary(
            message.body,
            activeMentionLabelResolverRef.current
          ),
        },
      }))
    },
    [activeConversationId, updateConversationDraft]
  )

  const revokeMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (!activeConversationId || !message.canRevoke) {
        return
      }

      void revokeConversationMessage(activeConversationId, message.id).catch(
        () => {
          toast.error("撤回消息失败")
        }
      )
    },
    [activeConversationId, revokeConversationMessage]
  )

  const updateMessageReaction = React.useCallback(
    async (
      message: ConversationPanelMessage,
      text: string,
      reacted: boolean
    ) => {
      await setMessageReaction(activeConversationId, message.id, text, reacted)
    },
    [activeConversationId, setMessageReaction]
  )
  const respondToActiveChoice = React.useCallback(
    (message: ConversationPanelMessage, optionIds: string[]) =>
      respondToChoice(activeConversationId, message.id, optionIds),
    [activeConversationId, respondToChoice]
  )

  const openForwardOperation = React.useCallback(
    (messageIds: string[], mode: ConversationPanelForwardMode) => {
      if (!activeConversationId || messageIds.length === 0) {
        return
      }
      if (mode === "merged" && messageIds.length < 2) {
        return
      }

      setForwardOperation({
        clientForwardId: createClientMessageId(),
        messageIds,
        mode,
        sourceConversationId: activeConversationId,
      })
    },
    [activeConversationId]
  )

  const forwardSingleMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      const clientMessage = activeClientMessagesByIdRef.current.get(message.id)
      if (clientMessage) {
        openForwardOperation([clientMessage.id], "separate")
      }
    },
    [openForwardOperation]
  )

  const startMessageSelection = React.useCallback(
    (message: ConversationPanelMessage) => startSelectingMessage(message.id),
    [startSelectingMessage]
  )

  const toggleSelectableMessage = React.useCallback(
    (messageId: string) => {
      const selected = selectedMessageIds.has(messageId)
      if (!selected && selectedMessageIds.size >= maxSelectedMessages) {
        toast.warning(`一次最多选择 ${maxSelectedMessages} 条消息`)
        return
      }
      toggleSelectedMessage(messageId)
    },
    [maxSelectedMessages, selectedMessageIds, toggleSelectedMessage]
  )
  const toggleMessageSelection = React.useCallback(
    (message: ConversationPanelMessage) => toggleSelectableMessage(message.id),
    [toggleSelectableMessage]
  )

  const recordTopicSourceMessage = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (!activeConversationId || activeConversationType !== "topic") {
        return
      }
      setLoadedTopicSource((current) =>
        current?.conversationId === activeConversationId &&
        current.message === message
          ? current
          : { conversationId: activeConversationId, message }
      )
    },
    [activeConversationId, activeConversationType]
  )

  const forwardTopicSourceMessage = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        openForwardOperation([message.id], "separate")
      }
    },
    [activeTopicSource, activeTopicSourceSelectable, openForwardOperation]
  )

  const startTopicSourceSelection = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        startSelectingMessage(message.id)
      }
    },
    [activeTopicSource, activeTopicSourceSelectable, startSelectingMessage]
  )

  const toggleTopicSourceSelection = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        toggleSelectableMessage(message.id)
      }
    },
    [activeTopicSource, activeTopicSourceSelectable, toggleSelectableMessage]
  )

  const forwardSelectedMessages = React.useCallback(
    (mode: ConversationPanelForwardMode) => {
      openForwardOperation(selectedForwardMessageIds, mode)
    },
    [openForwardOperation, selectedForwardMessageIds]
  )

  const activeHistoryHeader = React.useMemo(
    () =>
      activeConversation?.type === "topic" ? (
        <TopicSourceBanner
          appsById={contactAppsByLookup}
          conversationId={activeConversation.id}
          currentUserId={me.id}
          currentUser={me}
          mentionLabelResolver={activeMentionLabelResolver}
          onForward={forwardTopicSourceMessage}
          onMultiSelect={startTopicSourceSelection}
          onSourceMessageLoaded={recordTopicSourceMessage}
          onToggleSelected={toggleTopicSourceSelection}
          reactionConversationId={
            activeConversation.topic?.parentConversationId
          }
          selected={Boolean(
            activeTopicSource &&
            visibleMessageSelection.selectedMessageIds.has(activeTopicSource.id)
          )}
          selectionMode={visibleMessageSelection.active}
          showChoiceResponseCounts={
            activeConversation.topic?.parentConversationType === "group"
          }
          sourceMessage={activeTopicSource ?? undefined}
          usersById={usersById}
        />
      ) : undefined,
    [
      activeConversation,
      activeMentionLabelResolver,
      activeTopicSource,
      contactAppsByLookup,
      forwardTopicSourceMessage,
      me,
      recordTopicSourceMessage,
      startTopicSourceSelection,
      toggleTopicSourceSelection,
      usersById,
      visibleMessageSelection,
    ]
  )

  async function submitForwardOperation(targetConversationIds: string[]) {
    if (!forwardOperation) {
      throw new Error("转发操作不存在")
    }
    const result = await forwardConversationMessages(
      forwardOperation.sourceConversationId,
      {
        clientForwardId: forwardOperation.clientForwardId,
        messageIds: forwardOperation.messageIds,
        mode: forwardOperation.mode,
        targetConversationIds,
      }
    )
    for (const target of result.results) {
      if (target.status !== "sent") {
        continue
      }
      for (const message of target.messages) {
        mergeIncomingConversationMessage(message)
      }
    }
    return result
  }

  function clearSentReplyTarget(
    conversationId: string,
    replyToMessageId: string | undefined
  ) {
    if (!replyToMessageId) {
      return
    }

    updateConversationDraft(conversationId, (currentDraft) =>
      currentDraft.replyTarget?.id === replyToMessageId
        ? { ...currentDraft, replyTarget: null }
        : currentDraft
    )
    flushDrafts()
  }

  async function sendMessage(contentOverride?: string) {
    const visibleContent = (contentOverride ?? draft).trim()
    const content = visibleContent
    if (!content || !activeConversationId || activeMessageState?.sending) {
      return false
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const linkURL = normalizeSingleLinkMessageURL(visibleContent)
    const sendConversation = linkURL
      ? sendConversationLink
      : richTextMode
        ? sendConversationMarkdown
        : sendConversationText
    const sendContent = linkURL ?? content

    const message = await sendConversation(sendingConversationId, sendContent, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (!message) return false
    clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    return true
  }

  async function sendFileMessage(file: File) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationFile(sendingConversationId, file, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  async function sendImageMessage(
    image: File,
    caption: string,
    captionType: ImageCaptionType
  ) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationImage(sendingConversationId, image, {
      caption,
      captionType,
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  async function sendVoiceMessage(voice: VoiceMessageRecording) {
    if (!activeConversationId || activeMessageState?.sending) {
      return null
    }

    const sendingConversationId = activeConversationId
    const sendingReplyToMessageId = replyTarget?.id
    const message = await sendConversationVoice(sendingConversationId, voice, {
      replyToMessageId: sendingReplyToMessageId,
    })
    if (message) {
      clearSentReplyTarget(sendingConversationId, sendingReplyToMessageId)
    }

    return message
  }

  function selectConversation(conversationId: string) {
    flushDrafts()
    navigate(`/chat/${encodeURIComponent(conversationId)}`, { replace: true })
  }

  async function selectDirectoryItem(item: DirectorySearchItem) {
    try {
      const conversation = await openDirectoryItemConversation(item, {
        joinGroupConversation,
        openAppConversation,
        openDirectConversation,
        restoreConversation,
      })
      if (conversation) {
        selectConversation(conversation.id)
      }
    } catch {
      toast.error(getDirectoryItemOpenError(item))
    }
  }

  async function selectMessageSearchResult(result: ClientMessageSearchResult) {
    try {
      const existing = getConversation(result.conversation.id)
      if (result.conversation.type === "topic") {
        if (existing && !existing.topic?.archived) {
          selectConversation(existing.id)
          await focusConversationMessage(existing.id, {
            messageId: result.message.id,
            seq: result.message.seq,
          })
          return
        }
        const detail = await getConversationTopic(result.conversation.id)
        if (!getConversation(detail.parentConversation.id)) {
          await restoreConversation(detail.parentConversation.id)
        }
        selectConversation(detail.parentConversation.id)
        openTopicDrawer(detail.conversation.id)
        await focusConversationMessage(detail.conversation.id, {
          messageId: result.message.id,
          seq: result.message.seq,
        })
        return
      }
      if (existing) {
        selectConversation(existing.id)
        await focusConversationMessage(existing.id, {
          messageId: result.message.id,
          seq: result.message.seq,
        })
        return
      }
      const conversation = await restoreConversation(result.conversation.id)
      selectConversation(conversation.id)
      await focusConversationMessage(conversation.id, {
        messageId: result.message.id,
        seq: result.message.seq,
      })
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "无法打开搜索结果"))
    }
  }

  async function deleteConversation(conversationId: string) {
    await dismissConversation(conversationId)
    clearConversationDraft(conversationId)
    if (readLastConversationId(me.id) === conversationId) {
      clearLastConversationId(me.id)
    }
    if (activeConversationId === conversationId) {
      navigate("/chat", { replace: true })
    }
  }

  async function startGroupConversation(
    name: string,
    memberIds: string[],
    appIds: string[]
  ) {
    const conversation = await createGroupConversation(name, memberIds, appIds)
    flushDrafts()
    navigate(`/chat/${encodeURIComponent(conversation.id)}`)
  }

  async function confirmCreateTopic() {
    if (!createTopicOperation || creatingTopic) {
      return
    }
    const operation = createTopicOperation
    setCreatingTopic(true)
    try {
      const result = await createConversationTopic(
        operation.conversationId,
        operation.message.id
      )
      updateMessageTopic?.(operation.conversationId, operation.message.id, {
        archived: Boolean(result.conversation.topic?.archived),
        conversationId: result.conversation.id,
      })
      setCreateTopicOperation(null)
      toast.success(result.created ? "话题已创建" : "已打开现有话题")
      openTopicDrawer(result.conversation.id)
      void refreshConversations().catch(() => undefined)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "创建话题失败"))
    } finally {
      setCreatingTopic(false)
    }
  }

  return (
    <SidebarProvider
      className="min-h-0 min-w-0 flex-1"
      style={
        {
          "--sidebar-width": "18rem",
        } as React.CSSProperties
      }
    >
      <ConversationSidebar
        activeConversationId={activeConversationId}
        appsById={contactAppsByLookup}
        contactApps={contactApps}
        contactGroups={contactGroups}
        contacts={contacts}
        contactsById={contactsById}
        conversations={conversations}
        currentUser={me}
        drafts={drafts}
        getLatestCachedMessage={getLatestCachedMessage}
        onCreateGroup={() => {
          setCreateGroupDialogOpen(true)
          void Promise.resolve(refreshContacts()).catch(() => undefined)
        }}
        onManageFriends={() => setFriendManagementOpen(true)}
        onDismissConversation={deleteConversation}
        onOpenGlobalSearch={() =>
          void Promise.resolve(refreshContacts()).catch(() => undefined)
        }
        onSelectDirectoryItem={(item) => void selectDirectoryItem(item)}
        onSelectConversation={selectConversation}
        onSelectMessageResult={(result) =>
          void selectMessageSearchResult(result)
        }
        onSetConversationMuted={setConversationMuted}
        onSetConversationPinned={setConversationPinned}
      />

      <ConversationPanel
        key={activeConversationId || "empty"}
        conversation={activeConversation}
        conversationOnline={activeConversationOnline}
        currentUserId={me.id}
        draft={draft}
        draftMentions={activeDraft.mentions}
        historyError={activeMessageState?.error ?? null}
        historyLoading={historyLoading}
        historyLoadingBefore={Boolean(activeMessageState?.loadingBefore)}
        historyNavigation={activeHistoryNavigation}
        historyHeader={activeHistoryHeader}
        headerActions={
          activeConversation?.type === "topic" ? (
            activeConversation.canSend !== false ? (
              <TopicArchiveAction conversationId={activeConversation.id} />
            ) : undefined
          ) : activeConversation ? (
            <ConversationTopicsDialog
              conversation={activeConversation}
              onOpenTopic={openTopicDrawer}
            />
          ) : undefined
        }
        mentionLabelResolver={activeMentionLabelResolver}
        messages={activeMessages}
        conversationStatus={conversationStatus.status}
        messageSelection={visibleMessageSelection}
        onCancelMessageSelection={messageSelection.cancel}
        onCancelReply={clearReplyTarget}
        onCompactMessages={compactActiveConversationMessages}
        onRegisterMessageView={registerConversationMessageView}
        onDraftBlur={() => {
          conversationStatus.onBlur()
          flushDrafts()
        }}
        onDraftFocus={conversationStatus.onFocus}
        onDraftChange={setDraft}
        onCreateTopic={
          activeConversation?.type === "topic" ||
          activeConversation?.canSend === false
            ? undefined
            : requestCreateTopic
        }
        onForwardMessage={forwardSingleMessage}
        onForwardSelectedMessages={forwardSelectedMessages}
        onReplyToMessage={replyToMessage}
        onRevokeMessage={revokeMessage}
        onSetMessageReaction={updateMessageReaction}
        onRespondToChoice={respondToActiveChoice}
        onRichTextModeChange={setRichTextMode}
        onSendFile={sendFileMessage}
        onSendImage={sendImageMessage}
        onSendVoice={sendVoiceMessage}
        onLoadBeforeMessages={loadBeforeMessages}
        onOpenTopic={openTopicDrawer}
        onSendMessage={sendMessage}
        onStartMessageSelection={startMessageSelection}
        onToggleMessageSelection={toggleMessageSelection}
        replyTarget={replyTarget}
        richTextMode={richTextMode}
        readOnly={
          activeConversation?.topic?.archived ||
          activeConversation?.canSend === false
        }
        readOnlyReason={activeConversationReadOnlyReason}
        sending={Boolean(activeMessageState?.sending)}
      />
      <FriendManagementDialog
        acceptRequest={acceptFriendRequest}
        cancelRequest={cancelFriendRequest}
        contacts={contacts}
        createRequest={createFriendRequest}
        ensureUsers={ensureUsers}
        incomingRequests={incomingFriendRequests}
        onOpenChange={setFriendManagementOpen}
        open={friendManagementOpen}
        outgoingRequests={outgoingFriendRequests}
        rejectRequest={rejectFriendRequest}
        usersById={usersById}
      />

      <CreateGroupConversationDialog
        apps={contactApps}
        contacts={contacts}
        currentUserId={me.id}
        open={createGroupDialogOpen}
        onCreate={startGroupConversation}
        onOpenChange={setCreateGroupDialogOpen}
      />
      <CreateTopicConfirmDialog
        onConfirm={() => void confirmCreateTopic()}
        onOpenChange={(open) => {
          if (!open && !creatingTopic) {
            setCreateTopicOperation(null)
          }
        }}
        open={Boolean(createTopicOperation)}
        saving={creatingTopic}
      />
      {forwardOperation && (
        <ForwardMessageDialog
          conversations={conversations}
          messageCount={forwardOperation.messageIds.length}
          onComplete={messageSelection.cancel}
          onForward={submitForwardOperation}
          onOpenChange={(open) => {
            if (!open) {
              setForwardOperation(null)
            }
          }}
          open
        />
      )}
      <TopicDrawer
        conversationId={topicDrawerConversationId}
        onOpenChange={(open) => {
          if (!open) {
            closeTopicDrawer()
          }
        }}
        open={Boolean(topicDrawerConversationId)}
      />
    </SidebarProvider>
  )
}

function CreateTopicConfirmDialog({
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
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>创建话题</AlertDialogTitle>
          <AlertDialogDescription>
            将以这条消息作为起点创建一个独立话题，方便围绕它继续讨论。
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
          >
            {saving && <LoaderCircle className="size-4 animate-spin" />}
            确认创建
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function getConversationOnlineStatus(
  conversation: ClientConversation,
  currentUserId: string,
  contactsById: ReadonlyMap<string, ContactUser>,
  contactAppsByLookup: ReadonlyMap<string, ContactApp>
) {
  if (conversation.type === "direct") {
    const otherMember = conversation.members?.find(
      (member) => member.id !== currentUserId
    )

    return otherMember
      ? (contactsById.get(otherMember.id)?.online ?? false)
      : false
  }

  if (conversation.type === "app") {
    return (
      contactAppsByLookup.get(conversation.id)?.online ??
      contactAppsByLookup.get(conversation.name)?.online
    )
  }

  return undefined
}
