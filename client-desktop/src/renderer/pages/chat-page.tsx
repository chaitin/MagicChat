import * as React from "react"
import { LoaderCircle } from "lucide-react"
import { useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import { useClientData } from "@/lib/client-data-context"
import { useLocale } from "@/components/locale-provider"
import { useConversationDrafts } from "@/hooks/use-conversation-drafts"
import { useConversationStatus } from "@/hooks/use-conversation-status"
import { useMessageSelection } from "@/hooks/use-message-selection"
import {
  createConversationTopic,
  forwardConversationMessages,
  listConversationMessageChoiceSnapshots,
  listConversationMessageReactionSnapshots,
  type ClientConversation,
  type ClientMessage,
  type ClientMessageSearchResult,
  type ClientTopicSourceMessage,
  type ContactApp,
  type ContactUser,
  type MessageChoiceSnapshot,
  type MessageReactionSnapshot,
} from "@/lib/client-data-api"
import { applyTopicSourceMessageUpdate, getClientDataErrorMessage } from "@/lib/client-data-state"
import type { DirectorySearchItem } from "@/lib/local-search"
import { createClientMessageId } from "@/lib/message-id"
import {
  clearLastConversationId,
  readLastConversationId,
  writeLastConversationId,
} from "@/lib/last-conversation"
import { emptyConversationDraft, type ConversationDraftMention } from "@/lib/conversation-drafts"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import {
  formatConversationMessageSummary,
  toConversationPanelMessage,
} from "@/lib/conversation-message-presenter"
import { CreateGroupConversationDialog } from "@/components/conversation/create-group-conversation-dialog"
import { ForwardMessageDialog } from "@/components/conversation/forward-message-dialog"
import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import { FriendManagementDialog } from "@/components/contacts/friend-management-dialog"
import {
  TopicArchiveAction,
  TopicDrawer,
  TopicSourceBanner,
  TopicSourceChoiceSync,
  TopicSourceMessageSync,
  TopicSourceReactionSync,
} from "@/components/conversation/topic-drawer"
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
  messageTypes: ClientMessage["body"]["type"][]
  mode: ConversationPanelForwardMode
  sourceConversationId: string
}

type SelectableMessage = Pick<ClientMessage, "body" | "id"> | ClientTopicSourceMessage

type TopicSourceReactionState = {
  parentConversationId: string
  snapshot: MessageReactionSnapshot
  sourceMessageId: string
}

function canForwardOrSelectMessage(message: SelectableMessage) {
  return (
    message.body.type !== "choice" &&
    message.body.type !== "revoked" &&
    message.body.type !== "unsupported" &&
    message.body.type !== "system_event"
  )
}

function mergeTopicSourceReactionSnapshot(
  current: TopicSourceReactionState | null,
  parentConversationId: string,
  sourceMessageId: string,
  snapshot: MessageReactionSnapshot,
): TopicSourceReactionState {
  if (
    current?.parentConversationId === parentConversationId &&
    current.sourceMessageId === sourceMessageId &&
    current.snapshot.reactionVersion >= snapshot.reactionVersion
  ) {
    return current
  }
  return { parentConversationId, snapshot, sourceMessageId }
}

type CreateTopicOperation = {
  conversationId: string
  message: ConversationPanelMessage
}

function normalizeSingleLinkMessageURL(content: string) {
  const value = content.trim()
  if (!value || /\s/.test(value)) {
    return null
  }

  const linkCandidate = value.toLowerCase().startsWith("www.") ? `https://${value}` : value

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
  const { t } = useLocale()
  const navigate = useNavigate()
  const navigationIntentRef = React.useRef(0)
  const { conversationId } = useParams<{ conversationId?: string }>()
  const {
    acceptFriendRequest,
    cancelFriendRequest,
    contactApps,
    contactGroups,
    contacts,
    createFriendRequest,
    usersById = {},
    conversations,
    consumeConversationMessageFocus,
    createGroupConversation,
    compactConversationMessages,
    dismissConversation,
    ensureConversationMessages,
    ensureUsers,
    focusConversationMessage,
    getConversation,
    getConversationMessageState,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    markConversationRead,
    me,
    mergeIncomingConversationMessage,
    openAppConversation,
    openDirectConversation,
    restoreConversation,
    joinGroupConversation,
    refreshConversations,
    refreshFriendData,
    registerConversationMessageView,
    replaceWithLatestMessages,
    respondToChoice,
    revokeConversationMessage,
    rejectFriendRequest,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationText,
    sendConversationVoice,
    setConversationMuted,
    setConversationPinned,
    setMessageReaction,
    setForegroundConversationId,
    updateMessageTopic,
    incomingFriendRequests = [],
    outgoingFriendRequests = [],
  } = useClientData()
  const { clearConversationDraft, drafts, flushDrafts, updateConversationDraft } =
    useConversationDrafts(me.id)
  const [richTextMode, setRichTextMode] = React.useState(false)
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = React.useState(false)
  const [friendManagementOpen, setFriendManagementOpen] = React.useState(false)
  const [forwardOperation, setForwardOperation] = React.useState<ForwardOperation | null>(null)
  const [createTopicOperation, setCreateTopicOperation] =
    React.useState<CreateTopicOperation | null>(null)
  const [creatingTopic, setCreatingTopic] = React.useState(false)
  const [topicDrawerConversationId, setTopicDrawerConversationId] = React.useState("")
  const [loadedTopicSource, setLoadedTopicSource] = React.useState<{
    conversationId: string
    message: ClientTopicSourceMessage
  } | null>(null)
  const [topicSourceChoice, setTopicSourceChoice] = React.useState<{
    parentConversationId: string
    snapshot: MessageChoiceSnapshot
    sourceMessageId: string
  } | null>(null)
  const topicSourceChoiceRequestIdRef = React.useRef(0)
  const [topicSourceReaction, setTopicSourceReaction] =
    React.useState<TopicSourceReactionState | null>(null)
  React.useEffect(() => {
    if (friendManagementOpen) {
      void refreshFriendData({ includeContacts: false }).catch(() => undefined)
    }
  }, [friendManagementOpen, refreshFriendData])
  React.useEffect(() => () => setForegroundConversationId?.(""), [setForegroundConversationId])
  const requestedConversationId = conversationId ?? ""
  React.useLayoutEffect(() => {
    navigationIntentRef.current += 1
  }, [requestedConversationId])
  const storedConversationId = React.useMemo(
    () => (requestedConversationId ? "" : readLastConversationId(me.id)),
    [me.id, requestedConversationId],
  )
  const storedConversation = storedConversationId ? getConversation(storedConversationId) : null
  const resolvedConversationId = requestedConversationId || storedConversation?.id || ""

  const activeConversation = React.useMemo(
    () => (resolvedConversationId ? getConversation(resolvedConversationId) : null),
    [getConversation, resolvedConversationId],
  )

  const activeConversationId = activeConversation?.id ?? ""
  const activeConversationType = activeConversation?.type
  const conversationStatus = useConversationStatus({
    conversationId: activeConversationId,
    supported: activeConversationType === "app" || activeConversationType === "direct",
  })
  const compactActiveConversationMessages = React.useCallback(() => {
    compactConversationMessages?.(activeConversationId)
  }, [activeConversationId, compactConversationMessages])
  const openTopicDrawer = React.useCallback(
    (nextConversationId: string) => {
      setTopicDrawerConversationId(nextConversationId)
      setForegroundConversationId?.(nextConversationId)
    },
    [setForegroundConversationId],
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
    [activeConversationId, activeConversationType],
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
      activeConversation.lastReadSeq < activeConversation.lastMessageSeq),
  )
  const historyLoading = Boolean(
    activeConversation &&
    activeMessageState &&
    !activeMessageState.loaded &&
    !activeMessageState.error,
  )
  const activeConversationReadOnlyReason =
    activeConversation?.canSend === false && !activeConversation.topic?.archived
      ? activeConversation.type === "app" ||
        activeConversation.topic?.parentConversationType === "app"
        ? t("topic.noAccess")
        : t("topic.cannotSend")
      : undefined
  const activeClientMessages = activeMessageState?.messages ?? emptyClientMessages
  const activeClientMessagesById = React.useMemo(
    () => new Map(activeClientMessages.map((message) => [message.id, message])),
    [activeClientMessages],
  )
  const activeClientMessagesByIdRef = React.useRef(activeClientMessagesById)
  React.useEffect(() => {
    activeClientMessagesByIdRef.current = activeClientMessagesById
  }, [activeClientMessagesById])
  const contactsById = React.useMemo(
    () =>
      new Map([...contacts, ...Object.values(usersById)].map((contact) => [contact.id, contact])),
    [contacts, usersById],
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
    [activeConversation?.members, contactAppsByLookup, contactsById, me.id, me.name, me.nickname],
  )
  const activeMentionLabelResolverRef = React.useRef(activeMentionLabelResolver)
  React.useEffect(() => {
    activeMentionLabelResolverRef.current = activeMentionLabelResolver
  }, [activeMentionLabelResolver])
  const activeConversationOnline = activeConversation
    ? getConversationOnlineStatus(activeConversation, me.id, contactsById, contactAppsByLookup)
    : undefined
  const activeMessages = React.useMemo(
    () =>
      activeConversation
        ? activeClientMessages.map((message) =>
            toConversationPanelMessage(
              message,
              activeConversation,
              me,
              contactsById,
              contactAppsByLookup,
              activeClientMessagesById,
              activeMentionLabelResolver,
            ),
          )
        : [],
    [
      activeClientMessages,
      activeClientMessagesById,
      activeConversation,
      activeMentionLabelResolver,
      contactAppsByLookup,
      contactsById,
      me,
    ],
  )
  const activeTopicSource =
    loadedTopicSource?.conversationId === activeConversationId ? loadedTopicSource.message : null
  const activeTopicParentConversationId = activeConversation?.topic?.parentConversationId ?? ""
  const activeTopicSourceMessageId = activeTopicSource?.id ?? ""
  const activeTopicSourceChoice =
    topicSourceChoice?.parentConversationId === activeTopicParentConversationId &&
    topicSourceChoice.sourceMessageId === activeTopicSourceMessageId
      ? topicSourceChoice.snapshot
      : null
  const activeTopicSourceReaction =
    topicSourceReaction?.parentConversationId === activeTopicParentConversationId &&
    topicSourceReaction.sourceMessageId === activeTopicSourceMessageId
      ? topicSourceReaction.snapshot
      : null
  const activeTopicSourceSelectable = Boolean(
    activeTopicSource && canForwardOrSelectMessage(activeTopicSource),
  )
  const selectedForwardMessages = React.useMemo(() => {
    const messages: SelectableMessage[] = []
    if (
      activeTopicSourceSelectable &&
      activeTopicSource &&
      selectedMessageIds.has(activeTopicSource.id)
    ) {
      messages.push(activeTopicSource)
    }
    for (const message of activeClientMessages) {
      if (selectedMessageIds.has(message.id) && canForwardOrSelectMessage(message)) {
        messages.push(message)
      }
    }
    return messages
  }, [activeClientMessages, activeTopicSource, activeTopicSourceSelectable, selectedMessageIds])
  const visibleMessageSelection = React.useMemo(
    () => ({
      active: messageSelection.active,
      selectedMessageIds: new Set(selectedForwardMessages.map((message) => message.id)),
    }),
    [messageSelection.active, selectedForwardMessages],
  )

  React.useEffect(() => {
    if (requestedConversationId || !storedConversationId) {
      return
    }

    if (!storedConversation) {
      clearLastConversationId(me.id)
      return
    }

    navigationIntentRef.current += 1
    navigate(`/chat/${encodeURIComponent(storedConversation.id)}`, {
      replace: true,
    })
  }, [me.id, navigate, requestedConversationId, storedConversation, storedConversationId])

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
    [activeConversationId, updateConversationDraft],
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
    t,
  ])

  const loadBeforeMessages = React.useCallback(() => {
    if (!activeConversationId) {
      return
    }

    loadBeforeConversationMessages(activeConversationId)
  }, [activeConversationId, loadBeforeConversationMessages])

  const loadAfterMessages = React.useCallback(() => {
    if (!activeConversationId) return
    loadAfterConversationMessages(activeConversationId)
  }, [activeConversationId, loadAfterConversationMessages])

  const returnToLatestMessages = React.useCallback(() => {
    if (!activeConversationId) return
    replaceWithLatestMessages(activeConversationId)
  }, [activeConversationId, replaceWithLatestMessages])

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
            activeMentionLabelResolverRef.current,
          ),
        },
      }))
    },
    [activeConversationId, updateConversationDraft],
  )

  const revokeMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (!activeConversationId || !message.canRevoke) {
        return
      }

      void revokeConversationMessage(activeConversationId, message.id).catch(() => {
        toast.error(t("topic.revokeFailed"))
      })
    },
    [activeConversationId, revokeConversationMessage, t],
  )

  const updateMessageReaction = React.useCallback(
    async (message: ConversationPanelMessage, text: string, reacted: boolean) => {
      await setMessageReaction(activeConversationId, message.id, text, reacted)
    },
    [activeConversationId, setMessageReaction],
  )

  const respondToMessageChoice = React.useCallback(
    async (message: ConversationPanelMessage, optionIds: string[]) => {
      if (!respondToChoice) return
      await respondToChoice(activeConversationId, message.id, optionIds)
    },
    [activeConversationId, respondToChoice],
  )

  const openForwardOperation = React.useCallback(
    (messages: SelectableMessage[], mode: ConversationPanelForwardMode) => {
      if (
        !activeConversationId ||
        messages.length === 0 ||
        messages.some((message) => !canForwardOrSelectMessage(message))
      ) {
        return
      }
      if (mode === "merged" && messages.length < 2) {
        return
      }

      setForwardOperation({
        clientForwardId: createClientMessageId(),
        messageIds: messages.map((message) => message.id),
        messageTypes: messages.map((message) => message.body.type),
        mode,
        sourceConversationId: activeConversationId,
      })
    },
    [activeConversationId],
  )

  const forwardSingleMessage = React.useCallback(
    (message: ConversationPanelMessage) => {
      const clientMessage = activeClientMessagesByIdRef.current.get(message.id)
      if (clientMessage) {
        openForwardOperation([clientMessage], "separate")
      }
    },
    [openForwardOperation],
  )

  const startMessageSelection = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (canForwardOrSelectMessage(message)) startSelectingMessage(message.id)
    },
    [startSelectingMessage],
  )

  const toggleMessageSelection = React.useCallback(
    (message: ConversationPanelMessage) => {
      if (!canForwardOrSelectMessage(message)) return
      const selected = selectedMessageIds.has(message.id)
      if (!selected && selectedMessageIds.size >= maxSelectedMessages) {
        toast.warning(t("topic.maxSelected", { count: maxSelectedMessages }))
        return
      }
      toggleSelectedMessage(message.id)
    },
    [maxSelectedMessages, selectedMessageIds, toggleSelectedMessage, t],
  )

  const forwardSelectedMessages = React.useCallback(
    (mode: ConversationPanelForwardMode) => {
      openForwardOperation(selectedForwardMessages, mode)
    },
    [openForwardOperation, selectedForwardMessages],
  )

  const recordTopicSourceMessage = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (!activeConversationId || activeConversationType !== "topic") return
      setLoadedTopicSource({ conversationId: activeConversationId, message })
    },
    [activeConversationId, activeConversationType],
  )

  const handleActiveTopicSourceMessageUpdate = React.useCallback(
    (message: ClientMessage) => {
      setLoadedTopicSource((current) => {
        if (
          !current ||
          current.conversationId !== activeConversationId ||
          current.message.id !== message.id
        ) {
          return current
        }
        return { ...current, message: applyTopicSourceMessageUpdate(current.message, message) }
      })
      if (message.body.type === "revoked") {
        setTopicSourceReaction((current) =>
          current?.parentConversationId === message.conversationId &&
          current.sourceMessageId === message.id
            ? null
            : current,
        )
      }
    },
    [activeConversationId],
  )

  const refreshActiveTopicSourceChoice = React.useCallback(async () => {
    const requestId = ++topicSourceChoiceRequestIdRef.current
    if (
      activeTopicSource?.body.type !== "choice" ||
      !activeTopicParentConversationId ||
      !activeTopicSourceMessageId
    ) {
      setTopicSourceChoice(null)
      return
    }
    const [snapshot] = await listConversationMessageChoiceSnapshots(
      activeTopicParentConversationId,
      [activeTopicSourceMessageId],
    )
    if (requestId !== topicSourceChoiceRequestIdRef.current || !snapshot) return
    setTopicSourceChoice({
      parentConversationId: activeTopicParentConversationId,
      snapshot,
      sourceMessageId: activeTopicSourceMessageId,
    })
  }, [activeTopicParentConversationId, activeTopicSource, activeTopicSourceMessageId])

  const refreshActiveTopicSourceReaction = React.useCallback(async () => {
    if (!activeTopicParentConversationId || !activeTopicSourceMessageId) {
      setTopicSourceReaction(null)
      return
    }
    const [snapshot] = await listConversationMessageReactionSnapshots(
      activeTopicParentConversationId,
      [activeTopicSourceMessageId],
    )
    if (!snapshot) return
    setTopicSourceReaction((current) =>
      mergeTopicSourceReactionSnapshot(
        current,
        activeTopicParentConversationId,
        activeTopicSourceMessageId,
        snapshot,
      ),
    )
  }, [activeTopicParentConversationId, activeTopicSourceMessageId])

  React.useEffect(() => {
    if (activeTopicSource?.body.type !== "choice") {
      topicSourceChoiceRequestIdRef.current += 1
      setTopicSourceChoice(null)
      return
    }
    void refreshActiveTopicSourceChoice().catch(() => undefined)
    return () => {
      topicSourceChoiceRequestIdRef.current += 1
    }
  }, [activeTopicSource?.body.type, refreshActiveTopicSourceChoice])

  React.useEffect(() => {
    let active = true
    if (!activeTopicParentConversationId || !activeTopicSourceMessageId) {
      setTopicSourceReaction(null)
      return
    }
    void listConversationMessageReactionSnapshots(activeTopicParentConversationId, [
      activeTopicSourceMessageId,
    ])
      .then(([snapshot]) => {
        if (!active || !snapshot) return
        setTopicSourceReaction((current) =>
          mergeTopicSourceReactionSnapshot(
            current,
            activeTopicParentConversationId,
            activeTopicSourceMessageId,
            snapshot,
          ),
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [activeTopicParentConversationId, activeTopicSourceMessageId])

  const updateTopicSourceReaction = React.useCallback(
    async (text: string, reacted: boolean) => {
      if (!activeTopicParentConversationId || !activeTopicSourceMessageId) return
      const snapshot = await setMessageReaction(
        activeTopicParentConversationId,
        activeTopicSourceMessageId,
        text,
        reacted,
      )
      setTopicSourceReaction((current) =>
        mergeTopicSourceReactionSnapshot(
          current,
          activeTopicParentConversationId,
          activeTopicSourceMessageId,
          snapshot,
        ),
      )
    },
    [activeTopicParentConversationId, activeTopicSourceMessageId, setMessageReaction],
  )

  const respondToTopicSourceChoice = React.useCallback(
    async (optionIds: string[]) => {
      if (!respondToChoice || activeTopicSource?.body.type !== "choice") return
      await respondToChoice(activeTopicParentConversationId, activeTopicSourceMessageId, optionIds)
      await refreshActiveTopicSourceChoice()
    },
    [
      activeTopicParentConversationId,
      activeTopicSource,
      activeTopicSourceMessageId,
      refreshActiveTopicSourceChoice,
      respondToChoice,
    ],
  )

  const forwardTopicSourceMessage = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        openForwardOperation([message], "separate")
      }
    },
    [activeTopicSource, activeTopicSourceSelectable, openForwardOperation],
  )

  const startTopicSourceSelection = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        startSelectingMessage(message.id)
      }
    },
    [activeTopicSource, activeTopicSourceSelectable, startSelectingMessage],
  )

  const toggleTopicSourceSelection = React.useCallback(
    (message: ClientTopicSourceMessage) => {
      if (activeTopicSourceSelectable && activeTopicSource?.id === message.id) {
        const selected = selectedMessageIds.has(message.id)
        if (!selected && selectedMessageIds.size >= maxSelectedMessages) {
          toast.warning(t("topic.maxSelected", { count: maxSelectedMessages }))
          return
        }
        toggleSelectedMessage(message.id)
      }
    },
    [
      activeTopicSource,
      activeTopicSourceSelectable,
      maxSelectedMessages,
      selectedMessageIds,
      toggleSelectedMessage,
      t,
    ],
  )

  const activeHistoryHeader = React.useMemo(
    () =>
      activeConversation?.type === "topic" ? (
        <>
          <TopicSourceBanner
            appsById={contactAppsByLookup}
            conversationId={activeConversation.id}
            currentUserId={me.id}
            currentUser={me}
            mentionLabelResolver={activeMentionLabelResolver}
            onForward={forwardTopicSourceMessage}
            onMultiSelect={startTopicSourceSelection}
            onRespondToChoice={
              activeTopicSource?.body.type === "choice" &&
              getConversation(activeTopicParentConversationId)?.canSend !== false
                ? respondToTopicSourceChoice
                : undefined
            }
            onSetReaction={
              getConversation(activeTopicParentConversationId)?.canSend === false
                ? undefined
                : updateTopicSourceReaction
            }
            onSourceMessageLoaded={recordTopicSourceMessage}
            onToggleSelected={toggleTopicSourceSelection}
            reactionConversationId={activeTopicParentConversationId}
            reactions={activeTopicSourceReaction?.reactions}
            selected={Boolean(
              activeTopicSource &&
              visibleMessageSelection.selectedMessageIds.has(activeTopicSource.id),
            )}
            selectionMode={visibleMessageSelection.active}
            showChoiceResponseCounts={activeConversation.topic?.parentConversationType === "group"}
            sourceChoice={activeTopicSourceChoice?.choice}
            sourceChoiceStatus={activeTopicSourceChoice?.status}
            sourceMessage={activeTopicSource ?? undefined}
            usersById={usersById}
          />
          {activeTopicSource?.body.type === "choice" && activeTopicParentConversationId && (
            <TopicSourceChoiceSync
              conversationId={activeTopicParentConversationId}
              messageId={activeTopicSource.id}
              onUpdate={refreshActiveTopicSourceChoice}
            />
          )}
          {activeTopicSource && activeTopicParentConversationId && (
            <>
              <TopicSourceMessageSync
                conversationId={activeTopicParentConversationId}
                messageId={activeTopicSource.id}
                onUpdate={handleActiveTopicSourceMessageUpdate}
              />
              <TopicSourceReactionSync
                conversationId={activeTopicParentConversationId}
                messageId={activeTopicSource.id}
                onUpdate={refreshActiveTopicSourceReaction}
              />
            </>
          )}
        </>
      ) : undefined,
    [
      activeConversation,
      activeMentionLabelResolver,
      activeTopicParentConversationId,
      activeTopicSource,
      activeTopicSourceChoice,
      activeTopicSourceReaction,
      contactAppsByLookup,
      forwardTopicSourceMessage,
      getConversation,
      handleActiveTopicSourceMessageUpdate,
      me,
      recordTopicSourceMessage,
      refreshActiveTopicSourceChoice,
      refreshActiveTopicSourceReaction,
      respondToTopicSourceChoice,
      startTopicSourceSelection,
      toggleTopicSourceSelection,
      updateTopicSourceReaction,
      usersById,
      visibleMessageSelection,
    ],
  )

  async function submitForwardOperation(targetConversationIds: string[]) {
    if (!forwardOperation) {
      throw new Error("转发操作不存在")
    }
    if (forwardOperation.messageTypes.includes("choice")) {
      throw new Error("选择消息不能转发")
    }
    const result = await forwardConversationMessages(forwardOperation.sourceConversationId, {
      clientForwardId: forwardOperation.clientForwardId,
      messageIds: forwardOperation.messageIds,
      mode: forwardOperation.mode,
      targetConversationIds,
    })
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

  function clearSentReplyTarget(conversationId: string, replyToMessageId: string | undefined) {
    if (!replyToMessageId) {
      return
    }

    updateConversationDraft(conversationId, (currentDraft) =>
      currentDraft.replyTarget?.id === replyToMessageId
        ? { ...currentDraft, replyTarget: null }
        : currentDraft,
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

  async function sendImageMessage(image: File, caption: string, captionType: "text" | "markdown") {
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
    navigationIntentRef.current += 1
    flushDrafts()
    navigate(`/chat/${encodeURIComponent(conversationId)}`, { replace: true })
  }

  async function startGroupConversation(name: string, memberIds: string[], appIds: string[]) {
    navigationIntentRef.current += 1
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
      const result = await createConversationTopic(operation.conversationId, operation.message.id)
      updateMessageTopic?.(operation.conversationId, operation.message.id, {
        archived: Boolean(result.conversation.topic?.archived),
        conversationId: result.conversation.id,
      })
      setCreateTopicOperation(null)
      toast.success(result.created ? t("chat.topicCreated") : t("chat.topicOpened"))
      openTopicDrawer(result.conversation.id)
      void refreshConversations().catch(() => undefined)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("chat.topicCreateFailed")))
    } finally {
      setCreatingTopic(false)
    }
  }

  async function selectDirectoryItem(item: DirectorySearchItem) {
    const navigationIntent = ++navigationIntentRef.current
    try {
      const conversation =
        item.type === "user"
          ? await openDirectConversation(item.id)
          : item.type === "app"
            ? await openAppConversation(item.id)
            : item.joined
              ? await restoreConversation(item.id)
              : await joinGroupConversation(item.id)
      if (navigationIntentRef.current === navigationIntent) {
        selectConversation(conversation.id)
      }
    } catch (error) {
      if (navigationIntentRef.current === navigationIntent) {
        toast.error(getClientDataErrorMessage(error, t("chat.openConversationFailed")))
      }
    }
  }

  async function selectMessageSearchResult(result: ClientMessageSearchResult) {
    const navigationIntent = ++navigationIntentRef.current
    try {
      if (result.conversation.type === "topic") {
        openTopicDrawer(result.conversation.id)
        await focusConversationMessage(result.conversation.id, {
          messageId: result.message.id,
          seq: result.message.seq,
        })
        return
      }
      let conversation = getConversation(result.conversation.id)
      if (!conversation) conversation = await restoreConversation(result.conversation.id)
      if (navigationIntentRef.current !== navigationIntent) return
      selectConversation(conversation.id)
      await focusConversationMessage(conversation.id, {
        messageId: result.message.id,
        seq: result.message.seq,
      })
    } catch (error) {
      if (navigationIntentRef.current === navigationIntent) {
        toast.error(getClientDataErrorMessage(error, t("chat.openSearchResultFailed")))
      }
    }
  }

  async function deleteConversation(conversationId: string) {
    navigationIntentRef.current += 1
    await dismissConversation(conversationId)
    clearConversationDraft(conversationId)
    if (readLastConversationId(me.id) === conversationId) {
      clearLastConversationId(me.id)
    }
    if (activeConversationId === conversationId) {
      navigate("/chat", { replace: true })
    }
    if (topicDrawerConversationId === conversationId) {
      closeTopicDrawer()
    }
  }

  return (
    <SidebarProvider
      className="workspace-page-layout workspace-chat-layout min-h-0 min-w-0 flex-1"
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
        onAddFriend={() => setFriendManagementOpen(true)}
        onCreateGroup={() => setCreateGroupDialogOpen(true)}
        onDismissConversation={deleteConversation}
        onSelectDirectoryItem={(item) => void selectDirectoryItem(item)}
        onSelectMessageResult={(result) => void selectMessageSearchResult(result)}
        onSelectConversation={selectConversation}
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
        historyFocus={activeMessageState?.focus ?? null}
        historyLoading={historyLoading}
        historyLoadingAfter={Boolean(activeMessageState?.loadingAfter)}
        historyLoadingBefore={Boolean(activeMessageState?.loadingBefore)}
        historyHeader={activeHistoryHeader}
        historyMode={activeMessageState?.viewMode === "history"}
        historyPendingLatestMessageCount={activeMessageState?.pendingLatestMessageCount ?? 0}
        headerActions={
          activeConversation?.type === "topic" && activeConversation.canSend !== false ? (
            <TopicArchiveAction conversationId={activeConversation.id} />
          ) : undefined
        }
        mentionLabelResolver={activeMentionLabelResolver}
        messages={activeMessages}
        messageSelection={visibleMessageSelection}
        onCancelMessageSelection={messageSelection.cancel}
        onCancelReply={clearReplyTarget}
        onCompactMessages={compactActiveConversationMessages}
        onConsumeHistoryFocus={(focus) =>
          activeConversationId && consumeConversationMessageFocus(activeConversationId, focus)
        }
        onRegisterMessageView={registerConversationMessageView}
        onDraftBlur={() => {
          conversationStatus.onBlur()
          flushDrafts()
        }}
        onDraftChange={setDraft}
        onDraftFocus={conversationStatus.onFocus}
        onCreateTopic={
          activeConversation?.type === "topic" || activeConversation?.canSend === false
            ? undefined
            : requestCreateTopic
        }
        onForwardMessage={forwardSingleMessage}
        onForwardSelectedMessages={forwardSelectedMessages}
        onReplyToMessage={replyToMessage}
        onRevokeMessage={revokeMessage}
        onRespondToChoice={respondToChoice ? respondToMessageChoice : undefined}
        onSetMessageReaction={updateMessageReaction}
        onRichTextModeChange={setRichTextMode}
        onSendFile={sendFileMessage}
        onSendImage={sendImageMessage}
        onSendVoice={sendVoiceMessage}
        onLoadAfterMessages={loadAfterMessages}
        onLoadBeforeMessages={loadBeforeMessages}
        onRetryHistory={
          activeConversationId ? () => ensureConversationMessages(activeConversationId) : undefined
        }
        onOpenTopic={openTopicDrawer}
        onReturnToLatestMessages={returnToLatestMessages}
        onSendMessage={sendMessage}
        onStartMessageSelection={startMessageSelection}
        onToggleMessageSelection={toggleMessageSelection}
        replyTarget={replyTarget}
        richTextMode={richTextMode}
        readOnly={activeConversation?.topic?.archived || activeConversation?.canSend === false}
        readOnlyReason={activeConversationReadOnlyReason}
        sending={Boolean(activeMessageState?.sending)}
        status={conversationStatus.status}
      />
      <CreateGroupConversationDialog
        apps={contactApps}
        contacts={contacts}
        currentUserId={me.id}
        open={createGroupDialogOpen}
        onCreate={startGroupConversation}
        onOpenChange={setCreateGroupDialogOpen}
      />
      {ensureUsers &&
        createFriendRequest &&
        acceptFriendRequest &&
        rejectFriendRequest &&
        cancelFriendRequest && (
          <FriendManagementDialog
            acceptRequest={acceptFriendRequest}
            cancelRequest={cancelFriendRequest}
            contacts={contacts}
            createRequest={createFriendRequest}
            currentUserId={me.id}
            ensureUsers={ensureUsers}
            incomingRequests={incomingFriendRequests}
            onOpenChange={setFriendManagementOpen}
            open={friendManagementOpen}
            outgoingRequests={outgoingFriendRequests}
            rejectRequest={rejectFriendRequest}
            usersById={usersById}
          />
        )}
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
  const { t } = useLocale()
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("chat.createTopic.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("chat.createTopic.desc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>{t("topic.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {saving && <LoaderCircle className="size-4 animate-spin" />}
            {t("chat.confirmCreate")}
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
  contactAppsByLookup: ReadonlyMap<string, ContactApp>,
) {
  if (conversation.type === "direct") {
    const otherMember = conversation.members?.find((member) => member.id !== currentUserId)

    return otherMember ? (contactsById.get(otherMember.id)?.online ?? false) : false
  }

  if (conversation.type === "app") {
    return (
      contactAppsByLookup.get(conversation.id)?.online ??
      contactAppsByLookup.get(conversation.name)?.online
    )
  }

  return undefined
}
