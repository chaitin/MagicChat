import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  AlertCircleIcon,
  AppleReminderIcon,
  ArrowUp02Icon,
  Attachment01Icon,
  CirclePlusIcon,
  ContentWritingIcon,
  CrosshairIcon,
  FolderAttachmentIcon,
  FolderClosedIcon,
  Home07Icon,
  Image01Icon,
  Contact01Icon,
  FlashIcon,
  FloppyDiskIcon,
  UserSquareIcon,
  ChatIcon,
  Loading03Icon,
  Logout03Icon,
  MessageMultiple02Icon,
  MoreHorizontalIcon,
  NotificationOff01Icon,
  Search01Icon,
  UploadCircle01Icon,
  Settings02Icon,
  SmileIcon,
  SquareMIcon,
  UserAdd01Icon,
  UserIcon,
  Video01Icon,
  Mic01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { ExpressionPickerPanel } from "./expression-picker-panel"
import { MessageBodyRenderer } from "./message-body-renderer"
import { MessageReactionChips } from "./message-reaction-chips"
import { MessageReactionPicker } from "./message-reaction-picker"
import { SendFileMessageDialog } from "./send-file-message-dialog"
import { SettingsDialog } from "@/components/settings-dialog"
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
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Toggle } from "@/components/ui/toggle"
import {
  parseMentionTemplate,
  type MentionLabelResolver,
  type MentionTarget,
} from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import type {
  DesktopConversation,
  DesktopMessage,
  SelectedMessageFile,
} from "../../../shared/account-data"
import type { ServerCatalog } from "../../../shared/auth"
import { JIYING_HOMEPAGE, type ThemePreference } from "../../../shared/desktop"

type AppSection = "chat" | "contacts" | "projects" | "goals" | "documents" | "tasks" | "drive"

export function ChatPage({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  onThemeChange,
  onSignOut,
  onCatalogChange,
}: {
  targetId: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  theme: ThemePreference
  catalog: ServerCatalog
  isPreview: boolean
  onThemeChange: (theme: ThemePreference) => void
  onSignOut: () => Promise<boolean>
  onCatalogChange: (catalog: ServerCatalog) => void
}) {
  const { showToast } = useAnimatedToast()
  const [conversations, setConversations] = useState<DesktopConversation[]>([])
  const [messages, setMessages] = useState<DesktopMessage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<AppSection>("chat")
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingBeforeMessages, setLoadingBeforeMessages] = useState(false)
  const [hasMoreBeforeMessages, setHasMoreBeforeMessages] = useState(false)
  const [conversationRevision, setConversationRevision] = useState(0)
  const [messageRevision, setMessageRevision] = useState(0)
  const [contactRevision, setContactRevision] = useState(0)
  const [mentionLabels, setMentionLabels] = useState<Map<string, string>>(new Map())
  const [pendingReactionKeys, setPendingReactionKeys] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState("")
  const [markdownMode, setMarkdownMode] = useState(false)
  const [selectingFile, setSelectingFile] = useState(false)
  const [sendingFile, setSendingFile] = useState(false)
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<{
    file: SelectedMessageFile
    conversationId: string
    conversationName: string
  } | null>(null)
  const realtimeRevisionRef = useRef(0)
  const loadingBeforeRef = useRef(false)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const scrollToBottomRef = useRef(true)
  const selectedIdRef = useRef(selectedId)
  const loadedConversationIdRef = useRef<string | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pendingComposerCursorRef = useRef<number | null>(null)
  selectedIdRef.current = selectedId
  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  )
  const { pinnedConversations, regularConversations } = useMemo(
    () => ({
      pinnedConversations: conversations
        .filter((conversation) => conversation.pinned || conversation.isBuiltinAssistant)
        .sort(compareConversationActivity),
      regularConversations: conversations
        .filter((conversation) => !conversation.pinned && !conversation.isBuiltinAssistant)
        .sort(compareConversationActivity),
    }),
    [conversations],
  )

  useEffect(() => {
    if (!window.desktop) return
    return window.desktop.accountData.onChanged((event) => {
      if (event.targetId !== targetId || event.revision <= realtimeRevisionRef.current) return
      realtimeRevisionRef.current = event.revision
      if (event.domains.includes("conversations")) {
        setConversationRevision((revision) => revision + 1)
      }
      if (event.domains.includes("contacts")) {
        setContactRevision((revision) => revision + 1)
      }
      if (
        event.domains.includes("messages") &&
        selectedId &&
        (event.conversationIds.length === 0 || event.conversationIds.includes(selectedId))
      ) {
        setMessageRevision((revision) => revision + 1)
      }
    })
  }, [selectedId, targetId])

  useEffect(() => {
    let cancelled = false
    async function loadConversations() {
      if (!window.desktop || !targetId) return
      try {
        const result = await window.desktop.accountData.listConversations(targetId)
        if (cancelled) return
        if (result.ok) setConversations(result.data)
        else
          showToast({ status: "error", title: "无法读取对话", description: result.error.message })
      } catch {
        if (!cancelled) showToast({ status: "error", title: "无法读取对话" })
      } finally {
        if (!cancelled) setLoadingConversations(false)
      }
    }
    void loadConversations()
    return () => {
      cancelled = true
    }
  }, [conversationRevision, showToast, targetId])

  useEffect(() => {
    if (!window.desktop || !targetId) return
    let cancelled = false
    void window.desktop.accountData.getContacts(targetId).then((result) => {
      if (cancelled || !result.ok) return
      const labels = new Map<string, string>([[`user:${userId.toLowerCase()}`, userName]])
      for (const user of result.data.users) {
        labels.set(`user:${user.id.toLowerCase()}`, user.nickname || user.name)
      }
      for (const app of result.data.apps) {
        labels.set(`app:${app.id.toLowerCase()}`, app.name)
      }
      setMentionLabels(labels)
    })
    return () => {
      cancelled = true
    }
  }, [contactRevision, targetId, userId, userName])

  const resolveMentionLabel = useCallback(
    (target: MentionTarget) =>
      target.type === "all"
        ? undefined
        : mentionLabels.get(`${target.type}:${target.id.toLowerCase()}`),
    [mentionLabels],
  )

  const setMessageReaction = useCallback(
    async (message: DesktopMessage, text: string, reacted: boolean) => {
      const key = `${message.id}\0${text}`
      if (pendingReactionKeys.has(key) || !window.desktop) return
      setPendingReactionKeys((current) => new Set(current).add(key))
      try {
        const result = await window.desktop.accountData.setMessageReaction({
          targetId,
          conversationId: message.conversationId,
          messageId: message.id,
          text,
          reacted,
        })
        if (!result.ok) {
          showToast({
            status: "error",
            title: "更新表情失败",
            description: result.error.message,
          })
          return
        }
        setMessages(result.data)
      } catch {
        showToast({ status: "error", title: "更新表情失败" })
      } finally {
        setPendingReactionKeys((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    },
    [pendingReactionKeys, showToast, targetId],
  )

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

  const sendDraft = useCallback(() => {
    if (!selectedId || !window.desktop) return
    const content = draft.trim()
    if (!content) return
    const conversationId = selectedId
    const bodyType = markdownMode ? "markdown" : "text"
    setDraft("")
    scrollToBottomRef.current = true
    focusComposer()
    void window.desktop.accountData
      .sendTextMessage({ targetId, conversationId, content, bodyType })
      .then((result) => {
        if (selectedIdRef.current !== conversationId) return
        if (result.ok) {
          setMessages(result.data)
          return
        }
        showToast({
          status: "error",
          title: "发送消息失败",
          description: result.error.message,
        })
      })
      .catch(() => {
        if (selectedIdRef.current === conversationId) {
          showToast({ status: "error", title: "发送消息失败" })
        }
      })
  }, [draft, focusComposer, markdownMode, selectedId, showToast, targetId])

  const selectFile = useCallback(async () => {
    if (!window.desktop || !selected || selectingFile || sendingFile) return
    setSelectingFile(true)
    try {
      const result = await window.desktop.accountData.selectMessageFile(targetId)
      if (!result.ok) {
        showToast({
          status: "error",
          title: "选择文件失败",
          description: result.error.message,
        })
        return
      }
      if (!result.data) return
      setPendingFile({
        file: result.data,
        conversationId: selected.id,
        conversationName: selected.name,
      })
      setFileDialogOpen(true)
    } catch {
      showToast({ status: "error", title: "选择文件失败" })
    } finally {
      setSelectingFile(false)
    }
  }, [selected, selectingFile, sendingFile, showToast, targetId])

  const sendPendingFile = useCallback(async () => {
    if (!window.desktop || !pendingFile || sendingFile) return
    setSendingFile(true)
    try {
      const result = await window.desktop.accountData.sendFileMessage({
        targetId,
        conversationId: pendingFile.conversationId,
        selectionToken: pendingFile.file.token,
      })
      if (!result.ok) {
        showToast({
          status: "error",
          title: "发送文件失败",
          description: result.error.message,
        })
        return
      }
      if (selectedIdRef.current === pendingFile.conversationId) {
        scrollToBottomRef.current = true
        setMessages(result.data)
      }
      setFileDialogOpen(false)
      setPendingFile(null)
      focusComposer()
    } catch {
      showToast({ status: "error", title: "发送文件失败" })
    } finally {
      setSendingFile(false)
    }
  }, [focusComposer, pendingFile, sendingFile, showToast, targetId])

  const retryMessage = useCallback(
    (message: DesktopMessage) => {
      if (!window.desktop || !message.clientMessageId) return
      const conversationId = message.conversationId
      void window.desktop.accountData
        .retryMessage({
          targetId,
          conversationId,
          clientMessageId: message.clientMessageId,
        })
        .then((result) => {
          if (selectedIdRef.current !== conversationId) return
          if (result.ok) {
            setMessages(result.data)
            return
          }
          showToast({
            status: "error",
            title: "重试发送失败",
            description: result.error.message,
          })
        })
        .catch(() => {
          if (selectedIdRef.current === conversationId) {
            showToast({ status: "error", title: "重试发送失败" })
          }
        })
    },
    [showToast, targetId],
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

  const insertExpression = useCallback(
    (value: string) => {
      const composer = composerRef.current
      const selectionStart = composer?.selectionStart ?? draft.length
      const selectionEnd = composer?.selectionEnd ?? selectionStart
      const nextDraft = `${draft.slice(0, selectionStart)}${value}${draft.slice(selectionEnd)}`
      pendingComposerCursorRef.current = selectionStart + value.length
      setDraft(nextDraft)
    },
    [draft],
  )

  useEffect(() => {
    setDraft("")
    pendingComposerCursorRef.current = null
    if (selectedId) focusComposer()
  }, [focusComposer, selectedId])

  useEffect(() => {
    if (!selectedId || !window.desktop) {
      loadedConversationIdRef.current = null
      setMessages([])
      return
    }
    let cancelled = false
    const switchingConversation = loadedConversationIdRef.current !== selectedId
    loadedConversationIdRef.current = selectedId
    if (switchingConversation) {
      scrollToBottomRef.current = true
      prependSnapshotRef.current = null
      setHasMoreBeforeMessages(false)
      setLoadingMessages(true)
    }
    void window.desktop.accountData
      .listMessages({ targetId, conversationId: selectedId })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setMessages(result.data)
          setHasMoreBeforeMessages(result.data.length > 0 && result.data[0].seq > 1)
        } else {
          setMessages([])
          showToast({
            status: "error",
            title: "无法读取聊天记录",
            description: result.error.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
          showToast({ status: "error", title: "无法读取聊天记录" })
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false)
      })
    return () => {
      cancelled = true
    }
  }, [messageRevision, selectedId, showToast, targetId])

  useLayoutEffect(() => {
    if (!selected || loadingMessages) return
    const viewport = historyRef.current
    if (!viewport) return
    const snapshot = prependSnapshotRef.current
    if (snapshot) {
      viewport.scrollTop = snapshot.scrollTop + viewport.scrollHeight - snapshot.scrollHeight
      prependSnapshotRef.current = null
      return
    }
    if (scrollToBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      scrollToBottomRef.current = false
    }
  }, [loadingMessages, messages, selected])

  async function loadBeforeMessages() {
    if (
      !window.desktop ||
      !selectedId ||
      messages.length === 0 ||
      !hasMoreBeforeMessages ||
      loadingBeforeRef.current
    ) {
      return
    }
    const viewport = historyRef.current
    if (!viewport) return
    const conversationId = selectedId
    loadingBeforeRef.current = true
    setLoadingBeforeMessages(true)
    prependSnapshotRef.current = {
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    }
    try {
      const result = await window.desktop.accountData.loadBeforeMessages({
        targetId,
        conversationId,
        beforeSeq: messages[0].seq,
      })
      if (selectedIdRef.current !== conversationId) return
      if (!result.ok) {
        prependSnapshotRef.current = null
        showToast({
          status: "error",
          title: "无法加载更早消息",
          description: result.error.message,
        })
        return
      }
      setMessages(result.data.messages)
      setHasMoreBeforeMessages(result.data.hasMoreBefore)
    } catch {
      if (selectedIdRef.current === conversationId) {
        prependSnapshotRef.current = null
        showToast({ status: "error", title: "无法加载更早消息" })
      }
    } finally {
      loadingBeforeRef.current = false
      if (selectedIdRef.current === conversationId) setLoadingBeforeMessages(false)
    }
  }

  return (
    <main className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <AppRail
        targetId={targetId}
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        resolvedTheme={resolvedTheme}
        theme={theme}
        catalog={catalog}
        isPreview={isPreview}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onSignOut={onSignOut}
        onThemeChange={onThemeChange}
        onCatalogChange={onCatalogChange}
      />
      {activeSection === "chat" ? (
        <div className="grid min-w-0 flex-1 grid-cols-[19rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
            <header className="flex h-14 shrink-0 items-center gap-2 bg-xgui-background-0 pr-2 pl-3">
              <BeInput
                type="search"
                placeholder="搜索"
                aria-label="搜索会话"
                leftIcon={<HugeiconsIcon icon={Search01Icon} aria-hidden />}
                classNames={{
                  root: "min-w-0 flex-1",
                  field: "h-8 rounded-full border-transparent bg-background",
                  input: "pl-9 text-sm",
                }}
              />
              <BeButton
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-5"
                aria-label="新建会话"
                title="新建会话"
              >
                <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
              </BeButton>
            </header>

            <ScrollArea
              type="hover"
              scrollHideDelay={200}
              className="min-h-0 min-w-0 flex-1 overflow-hidden bg-xgui-background-1"
              viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
            >
              <nav className="min-h-full" aria-label="对话列表">
                {loadingConversations ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      className="size-5 animate-spin"
                      aria-label="正在读取对话"
                    />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    暂无对话
                  </div>
                ) : (
                  <>
                    {pinnedConversations.length > 0 ? (
                      <div className="bg-xgui-background-0 px-2 py-1">
                        <ConversationGroup
                          conversations={pinnedConversations}
                          selectedId={selectedId}
                          targetId={targetId}
                          resolvedTheme={resolvedTheme}
                          mentionLabelResolver={resolveMentionLabel}
                          onSelect={setSelectedId}
                        />
                      </div>
                    ) : null}
                    {regularConversations.length > 0 ? (
                      <div className="px-2 py-1">
                        <ConversationGroup
                          conversations={regularConversations}
                          selectedId={selectedId}
                          targetId={targetId}
                          resolvedTheme={resolvedTheme}
                          mentionLabelResolver={resolveMentionLabel}
                          onSelect={setSelectedId}
                        />
                      </div>
                    ) : null}
                  </>
                )}
              </nav>
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-card" aria-label="聊天区域">
            {selected ? (
              <>
                <header className="flex h-14 shrink-0 items-center gap-3 border-b border-xgui-background-1 px-6">
                  <EntityAvatar
                    targetId={targetId}
                    type={selected.avatarType}
                    id={selected.avatarId}
                    theme={resolvedTheme}
                    size={36}
                    label={`${selected.name}头像`}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm">{selected.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {conversationTypeLabel(selected.type)}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {selected.type !== "topic" && (
                      <HeaderActionButton
                        label="话题列表"
                        icon={MessageMultiple02Icon}
                        onClick={() => showPendingFeature(showToast, "话题列表")}
                      />
                    )}
                    {selected.type === "group" && (
                      <HeaderActionButton
                        label="添加成员"
                        icon={UserAdd01Icon}
                        onClick={() => showPendingFeature(showToast, "添加成员")}
                      />
                    )}
                    {selected.type !== "topic" && (
                      <HeaderActionButton
                        label="附件列表"
                        icon={FolderAttachmentIcon}
                        onClick={() => showPendingFeature(showToast, "附件列表")}
                      />
                    )}
                    {selected.type !== "topic" && (
                      <HeaderActionButton
                        label="对话设置"
                        icon={Settings02Icon}
                        onClick={() => showPendingFeature(showToast, "对话设置")}
                      />
                    )}
                  </div>
                </header>

                <ScrollArea
                  data-chat-history
                  type="hover"
                  scrollHideDelay={200}
                  viewportRef={historyRef}
                  onViewportScroll={(event) => {
                    if (event.currentTarget.scrollTop <= 80) void loadBeforeMessages()
                  }}
                  className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
                  viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
                >
                  <div className="min-h-full p-6">
                    {loadingMessages ? (
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
                        {loadingBeforeMessages && (
                          <div className="flex justify-center pb-4 text-muted-foreground">
                            <HugeiconsIcon
                              icon={Loading03Icon}
                              className="size-4 animate-spin"
                              aria-label="正在加载更早消息"
                            />
                          </div>
                        )}
                        <div className="flex w-full flex-col gap-5">
                          {messages.map((message, index) => {
                            const flushMediaBubble = shouldFlushMediaBubble(message)
                            return (
                              <Fragment key={message.id}>
                                {shouldShowMessageTimeMarker(messages[index - 1], message) && (
                                  <div className="text-center text-xs text-muted-foreground">
                                    {formatMessageTime(message.createdAt)}
                                  </div>
                                )}
                                {message.body.type === "system_event" ? (
                                  <article className="flex justify-center">
                                    <Badge variant="secondary">
                                      <MessageBodyRenderer
                                        body={message.body}
                                        targetId={targetId}
                                        currentUserId={userId}
                                        mentionLabelResolver={resolveMentionLabel}
                                        conversationName={selected.name}
                                      />
                                    </Badge>
                                  </article>
                                ) : (
                                  <article
                                    className={cn(
                                      "group/message-row flex items-start gap-2",
                                      message.isMine ? "justify-end" : "justify-start",
                                    )}
                                  >
                                    {!message.isMine &&
                                      message.senderId &&
                                      (message.senderType === "user" ||
                                        message.senderType === "app") && (
                                        <EntityAvatar
                                          targetId={targetId}
                                          type={message.senderType}
                                          id={message.senderId}
                                          theme={resolvedTheme}
                                          size={32}
                                        />
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
                                                : selected.name)}
                                        </span>
                                        <span className="shrink-0">
                                          {formatMessageTime(message.createdAt)}
                                        </span>
                                      </div>
                                      <div
                                        className={cn(
                                          "flex max-w-full items-end gap-1.5",
                                          message.isMine && "flex-row-reverse",
                                        )}
                                      >
                                        <div
                                          className={cn(
                                            "max-w-full rounded-xl text-sm leading-6",
                                            flushMediaBubble
                                              ? "overflow-hidden p-0"
                                              : "px-4 py-2.5",
                                            message.isMine
                                              ? "rounded-tr-sm bg-xgui-brand-1 hover:bg-xgui-brand-1"
                                              : "rounded-tl-sm bg-muted hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60",
                                          )}
                                        >
                                          {message.replyTo && (
                                            <div className="mb-2 border-l-2 border-foreground/20 pl-2 text-xs">
                                              <div className="truncate font-medium text-foreground/80">
                                                {message.replyTo.author}
                                              </div>
                                              <div className="line-clamp-2 text-muted-foreground">
                                                {message.replyTo.summary}
                                              </div>
                                            </div>
                                          )}
                                          <MessageBodyRenderer
                                            body={message.body}
                                            targetId={targetId}
                                            currentUserId={userId}
                                            mentionLabelResolver={resolveMentionLabel}
                                            conversationName={selected.name}
                                            flushMedia={flushMediaBubble}
                                          />
                                          {message.reactions.length > 0 && (
                                            <div className={cn(flushMediaBubble && "mx-2 mb-2")}>
                                              <MessageReactionChips
                                                targetId={targetId}
                                                conversationId={message.conversationId}
                                                messageId={message.id}
                                                reactions={message.reactions}
                                                pendingKeys={pendingReactionKeys}
                                                resolveLabel={resolveMentionLabel}
                                                onSetReaction={(text, reacted) =>
                                                  setMessageReaction(message, text, reacted)
                                                }
                                              />
                                            </div>
                                          )}
                                          {message.topic && (
                                            <div className="mt-2 border-t border-foreground/10 pt-2 text-xs text-muted-foreground">
                                              {message.topic.archived
                                                ? "话题已归档"
                                                : "查看话题回复"}
                                            </div>
                                          )}
                                        </div>
                                        {message.deliveryStatus === "sending" && (
                                          <span className="mb-2 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                                            <HugeiconsIcon
                                              icon={Loading03Icon}
                                              className="size-5 animate-spin"
                                              aria-label="消息发送中"
                                            />
                                          </span>
                                        )}
                                        {message.deliveryStatus === "failed" && (
                                          <button
                                            type="button"
                                            className="group/status mb-2 flex size-7 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
                                            aria-label="重试发送消息"
                                            title="发送失败，点击重试"
                                            onClick={() => retryMessage(message)}
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
                                        )}
                                        {!message.deliveryStatus &&
                                          message.body.type !== "revoked" &&
                                          message.body.type !== "unsupported" && (
                                            <div className="mb-2 flex h-7 shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/message-row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                                              <MessageReactionPicker
                                                align={message.isMine ? "end" : "start"}
                                                onSelect={(text) =>
                                                  setMessageReaction(message, text, true)
                                                }
                                              />
                                              <MessageHoverActionButton
                                                label="更多操作"
                                                icon={MoreHorizontalIcon}
                                                onClick={() =>
                                                  showPendingFeature(showToast, "消息更多操作")
                                                }
                                              />
                                            </div>
                                          )}
                                      </div>
                                    </div>
                                    {message.isMine && (
                                      <EntityAvatar
                                        targetId={targetId}
                                        type="user"
                                        id={userId}
                                        theme={resolvedTheme}
                                        size={32}
                                        label={`${userName}头像`}
                                      />
                                    )}
                                  </article>
                                )}
                              </Fragment>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>

                <footer className="shrink-0 bg-card p-4">
                  <div className="w-full">
                    <InputGroup className="bg-background">
                      <InputGroupTextarea
                        ref={composerRef}
                        value={draft}
                        placeholder={markdownMode ? "输入 Markdown 消息" : "输入消息"}
                        className="max-h-48 min-h-24"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                      />
                      <InputGroupAddon align="block-end" className="justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <ComposerExpressionPicker
                            onSelect={insertExpression}
                            onRestoreFocus={focusComposer}
                          />
                          <Toggle
                            type="button"
                            size="sm"
                            className="size-8 p-0 aria-pressed:text-xgui-brand"
                            pressed={markdownMode}
                            aria-label="支持 Markdown"
                            title="支持 Markdown"
                            onPressedChange={(pressed) => {
                              setMarkdownMode(pressed)
                              focusComposer()
                            }}
                          >
                            <HugeiconsIcon icon={SquareMIcon} className="size-4" aria-hidden />
                          </Toggle>
                          <ComposerButton
                            label={selectingFile ? "正在选择文件" : "上传文件"}
                            icon={selectingFile ? Loading03Icon : Attachment01Icon}
                            disabled={selectingFile || sendingFile}
                            loading={selectingFile}
                            onClick={selectFile}
                          />
                          <ComposerButton label="插入图片" icon={Image01Icon} />
                          <ComposerButton label="插入视频" icon={Video01Icon} />
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ComposerButton label="语音输入" icon={Mic01Icon} />
                          <BeButton
                            type="button"
                            aria-label="发送消息"
                            className="gap-1 bg-xgui-brand pr-4 pl-3 text-background hover:bg-xgui-brand-4 hover:text-background active:bg-xgui-brand-5"
                            size="sm"
                            variant="primary"
                            disabled={!draft.trim()}
                            onClick={sendDraft}
                          >
                            <HugeiconsIcon icon={ArrowUp02Icon} className="size-4" aria-hidden />
                            发送
                          </BeButton>
                        </div>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                </footer>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xgui-background-2">
                <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
                  <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
                </span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <SectionPlaceholder section={activeSection} />
      )}
      <SendFileMessageDialog
        conversationName={pendingFile?.conversationName ?? ""}
        file={pendingFile?.file ?? null}
        open={fileDialogOpen}
        sending={sendingFile}
        onConfirm={sendPendingFile}
        onOpenChange={(open) => {
          if (sendingFile) return
          setFileDialogOpen(open)
          if (!open) {
            setPendingFile(null)
            focusComposer()
          }
        }}
      />
    </main>
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

function HeaderActionButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: HugeiconsIconProps["icon"]
  onClick: () => void
}) {
  return (
    <BeButton
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-4"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} aria-hidden />
    </BeButton>
  )
}

function showPendingFeature(
  showToast: ReturnType<typeof useAnimatedToast>["showToast"],
  label: string,
) {
  showToast({ status: "info", title: `${label}功能将在下一阶段接入` })
}

function ComposerExpressionPicker({
  onSelect,
  onRestoreFocus,
}: {
  onSelect: (value: string) => void
  onRestoreFocus: () => void
}) {
  const [open, setOpen] = useState(false)

  function select(value: string) {
    setOpen(false)
    onSelect(value)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BeButton aria-label="选择表情" title="选择表情" size="icon" variant="ghost">
          <HugeiconsIcon icon={SmileIcon} aria-hidden />
        </BeButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto p-3"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <ExpressionPickerPanel onSelect={select} />
      </PopoverContent>
    </Popover>
  )
}

function ComposerButton({
  label,
  icon,
  disabled,
  loading = false,
  onClick,
}: {
  label: string
  icon: HugeiconsIconProps["icon"]
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}) {
  return (
    <BeButton
      type="button"
      aria-label={label}
      title={label}
      size="icon"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className={cn(loading && "animate-spin")} aria-hidden />
    </BeButton>
  )
}

function ConversationGroup({
  conversations,
  selectedId,
  targetId,
  resolvedTheme,
  mentionLabelResolver,
  onSelect,
}: {
  conversations: DesktopConversation[]
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelect: (id: string) => void
}) {
  return (
    <ItemGroup className="has-data-[size=sm]:gap-1">
      {conversations.map((conversation) => {
        const active = conversation.id === selectedId
        return (
          <Item
            key={conversation.id}
            asChild
            variant="default"
            size="sm"
            className={cn(
              "flex-nowrap border-transparent text-left hover:bg-foreground/5 hover:text-foreground",
              active &&
                "bg-xgui-brand-1 text-sidebar-accent-foreground hover:bg-xgui-brand-1 hover:text-sidebar-accent-foreground",
            )}
          >
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(conversation.id)}
            >
              <EntityAvatar
                targetId={targetId}
                type={conversation.avatarType}
                id={conversation.avatarId}
                theme={resolvedTheme}
                size={40}
                label={`${conversation.name}头像`}
              />
              <ItemContent className="w-0 min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm leading-snug font-medium">
                    {conversation.name}
                  </div>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {formatConversationTime(conversation.lastMessageAt ?? conversation.createdAt)}
                  </span>
                </div>
                <p className="flex min-w-0 items-center gap-0.5 text-left text-sm leading-normal font-normal text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {formatConversationSummary(
                      conversation.lastMessageSummary,
                      mentionLabelResolver,
                    )}
                  </span>
                  {conversation.notificationMuted && (
                    <HugeiconsIcon
                      icon={NotificationOff01Icon}
                      className="size-3 shrink-0"
                      aria-label="消息免打扰"
                    />
                  )}
                </p>
              </ItemContent>
            </button>
          </Item>
        )
      })}
    </ItemGroup>
  )
}

function formatConversationSummary(summary: string, mentionLabelResolver: MentionLabelResolver) {
  if (!summary) return "暂无消息"
  return parseMentionTemplate(summary, mentionLabelResolver)
    .map((part) => (part.type === "text" ? part.text : part.label))
    .join("")
}

function compareConversationActivity(left: DesktopConversation, right: DesktopConversation) {
  if (left.isBuiltinAssistant !== right.isBuiltinAssistant) {
    return left.isBuiltinAssistant ? -1 : 1
  }
  const leftTime = parseConversationActivity(left.lastMessageAt ?? left.createdAt)
  const rightTime = parseConversationActivity(right.lastMessageAt ?? right.createdAt)
  return rightTime - leftTime || left.name.localeCompare(right.name, "zh-CN")
}

function parseConversationActivity(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function SectionPlaceholder({ section }: { section: Exclude<AppSection, "chat"> }) {
  const content = {
    contacts: { label: "通讯录", icon: Contact01Icon },
    projects: { label: "项目管理", icon: FolderClosedIcon },
    goals: { label: "目标管理", icon: CrosshairIcon },
    documents: { label: "文档", icon: ContentWritingIcon },
    tasks: { label: "任务", icon: AppleReminderIcon },
    drive: { label: "云网盘", icon: FloppyDiskIcon },
  }[section]
  return (
    <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-card text-center text-muted-foreground">
      <span className="flex size-14 items-center justify-center rounded-full bg-xgui-background-1 text-xgui-brand">
        <HugeiconsIcon icon={content.icon} className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="font-medium text-foreground">{content.label}</h1>
        <p className="text-sm">功能内容尚未接入</p>
      </div>
    </section>
  )
}

function AccountMenu({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  onSignOut,
}: {
  targetId: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  onSignOut: () => Promise<boolean>
}) {
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)

  async function confirmSignOut() {
    if (logoutPending) return
    setLogoutPending(true)
    const signedOut = await onSignOut().catch(() => false)
    if (!signedOut) setLogoutPending(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="用户菜单"
            title={userName}
            className="mb-6 flex size-10 shrink-0 items-center justify-center rounded-sm bg-xgui-background-1 outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-foreground/10"
          >
            <EntityAvatar
              targetId={targetId}
              type="user"
              id={userId}
              theme={resolvedTheme}
              size={36}
              label={`${userName}头像`}
              className="rounded-sm"
              imageBackgroundClassName="bg-transparent"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-64">
          <div
            role="group"
            aria-label="用户信息"
            className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 px-2 py-3"
          >
            <EntityAvatar
              targetId={targetId}
              type="user"
              id={userId}
              theme={resolvedTheme}
              size={48}
              label={`${userName}头像`}
              className="row-span-2 rounded-sm"
            />
            <span className="min-w-0 truncate text-sm font-semibold">{userName}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {userEmail || "未设置"}
            </span>
          </div>
          <DropdownMenuItem>
            <HugeiconsIcon icon={UserIcon} className="size-4" aria-hidden />
            个人资料
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={logoutPending}
            onSelect={() => setLogoutOpen(true)}
          >
            <HugeiconsIcon icon={Logout03Icon} className="size-4" aria-hidden />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={logoutOpen}
        onOpenChange={(open) => {
          if (!logoutPending) setLogoutOpen(open)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出登录</AlertDialogTitle>
            <AlertDialogDescription>当前会话将结束，你可以稍后重新登录。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={logoutPending}
              onClick={(event) => {
                event.preventDefault()
                void confirmSignOut()
              }}
            >
              {logoutPending ? (
                <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />
              ) : null}
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AppRail({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  activeSection,
  onSectionChange,
  onSignOut,
  onThemeChange,
  onCatalogChange,
}: {
  targetId: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  theme: ThemePreference
  catalog: ServerCatalog
  isPreview: boolean
  activeSection: AppSection
  onSectionChange: (section: AppSection) => void
  onSignOut: () => Promise<boolean>
  onThemeChange: (theme: ThemePreference) => void
  onCatalogChange: (catalog: ServerCatalog) => void
}) {
  const { showToast } = useAnimatedToast()
  const navigationItems = [
    { id: "chat", label: "聊天", icon: ChatIcon },
    { id: "contacts", label: "通讯录", icon: UserSquareIcon },
    { id: "projects", label: "项目管理", icon: FolderClosedIcon },
    { id: "goals", label: "目标管理", icon: CrosshairIcon },
    { id: "documents", label: "文档", icon: ContentWritingIcon },
    { id: "tasks", label: "任务", icon: AppleReminderIcon },
    { id: "drive", label: "云网盘", icon: FloppyDiskIcon },
  ] as const

  async function openHomepage() {
    if (!window.desktop) {
      window.open(JIYING_HOMEPAGE, "_blank", "noopener,noreferrer")
      return
    }
    try {
      const result = await window.desktop.openHomepage()
      if (!result.ok) {
        showToast({ status: "error", title: "无法打开链接", description: result.error.message })
      }
    } catch {
      showToast({ status: "error", title: "无法打开链接，请稍后重试" })
    }
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center bg-xgui-background-6 py-3">
      <AccountMenu
        targetId={targetId}
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        resolvedTheme={resolvedTheme}
        onSignOut={onSignOut}
      />

      <nav className="flex flex-1 flex-col gap-2" aria-label="主导航">
        {navigationItems.map((item) => {
          const active = activeSection === item.id
          return (
            <BeButton
              key={item.id}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-full hover:bg-foreground/10",
                active && "bg-xgui-brand text-background hover:bg-xgui-brand hover:text-background",
              )}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
              onClick={() => onSectionChange(item.id)}
            >
              <HugeiconsIcon icon={item.icon} aria-hidden />
            </BeButton>
          )
        })}
      </nav>

      <BeButton
        type="button"
        variant="ghost"
        size="icon"
        className="mb-2 rounded-lg hover:bg-foreground/10"
        aria-label="即应官网"
        title="即应官网"
        onClick={() => void openHomepage()}
      >
        <HugeiconsIcon icon={Home07Icon} aria-hidden />
      </BeButton>

      <SettingsDialog
        theme={theme}
        catalog={catalog}
        disabled={isPreview}
        onThemeChange={onThemeChange}
        onCatalogChange={onCatalogChange}
        trigger={
          <BeButton
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-lg hover:bg-foreground/10"
            aria-label="设置"
            title="设置"
          >
            <HugeiconsIcon icon={Settings02Icon} aria-hidden />
          </BeButton>
        }
      />
    </aside>
  )
}

function formatConversationTime(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
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

function conversationTypeLabel(type: string): string {
  if (type === "group") return "群聊"
  if (type === "app") return "应用会话"
  if (type === "topic") return "话题"
  return "单聊"
}
