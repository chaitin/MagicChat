import { useEffect, useMemo, useRef, useState } from "react"
import {
  AppleReminderIcon,
  CirclePlusIcon,
  ContentWritingIcon,
  CrosshairIcon,
  FolderClosedIcon,
  Home07Icon,
  Contact01Icon,
  FlashIcon,
  FloppyDiskIcon,
  UserSquareIcon,
  ChatIcon,
  Loading03Icon,
  Logout03Icon,
  NotificationOff01Icon,
  Search01Icon,
  SentIcon,
  Settings02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { DesktopConversation, DesktopMessage } from "../../../shared/account-data"
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
  const [conversationRevision, setConversationRevision] = useState(0)
  const [messageRevision, setMessageRevision] = useState(0)
  const realtimeRevisionRef = useRef(0)
  const historyRef = useRef<HTMLDivElement>(null)
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
    if (!selectedId || !window.desktop) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoadingMessages(true)
    void window.desktop.accountData
      .listMessages({ targetId, conversationId: selectedId })
      .then((result) => {
        if (cancelled) return
        if (result.ok) setMessages(result.data)
        else {
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

  useEffect(() => {
    if (!selected || loadingMessages) return
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight })
  }, [loadingMessages, messages, selected])

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
                <header className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
                  <EntityAvatar
                    targetId={targetId}
                    type={selected.avatarType}
                    id={selected.avatarId}
                    theme={resolvedTheme}
                    size={36}
                    label={`${selected.name}头像`}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{selected.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {conversationTypeLabel(selected.type)}
                    </p>
                  </div>
                </header>

                <div ref={historyRef} className="min-h-0 flex-1 overflow-y-auto bg-background p-6">
                  {loadingMessages ? (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        className="size-5 animate-spin"
                        aria-label="正在读取聊天记录"
                      />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      暂无聊天记录
                    </div>
                  ) : (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                      {messages.map((message) => (
                        <article
                          key={message.id}
                          className={cn(
                            "flex items-start gap-2",
                            message.isMine ? "justify-end" : "justify-start",
                          )}
                        >
                          {!message.isMine &&
                            message.senderId &&
                            (message.senderType === "user" || message.senderType === "app") && (
                              <EntityAvatar
                                targetId={targetId}
                                type={message.senderType}
                                id={message.senderId}
                                theme={resolvedTheme}
                                size={32}
                              />
                            )}
                          <div className="max-w-[75%] space-y-1">
                            <div
                              className={cn(
                                "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6",
                                message.isMine
                                  ? "rounded-br-md bg-xgui-brand-1"
                                  : "rounded-bl-md bg-muted",
                              )}
                            >
                              {message.content}
                            </div>
                            <p
                              className={cn(
                                "px-1 text-xs text-muted-foreground",
                                message.isMine && "text-right",
                              )}
                            >
                              {formatMessageTime(message.createdAt)}
                            </p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <footer className="shrink-0 border-t bg-card p-4">
                  <div className="mx-auto flex w-full max-w-3xl items-end gap-3">
                    <Textarea
                      disabled
                      placeholder="消息发送将在下一阶段接入"
                      className="max-h-32 min-h-11 resize-none rounded-2xl"
                      rows={1}
                    />
                    <BeButton
                      type="button"
                      variant="primary"
                      size="icon"
                      aria-label="发送消息"
                      disabled
                    >
                      <HugeiconsIcon icon={SentIcon} aria-hidden />
                    </BeButton>
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
    </main>
  )
}

function ConversationGroup({
  conversations,
  selectedId,
  targetId,
  resolvedTheme,
  onSelect,
}: {
  conversations: DesktopConversation[]
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
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
                    {conversation.lastMessageSummary || "暂无消息"}
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
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function conversationTypeLabel(type: string): string {
  if (type === "group") return "群聊"
  if (type === "app") return "应用会话"
  if (type === "topic") return "话题"
  return "单聊"
}
