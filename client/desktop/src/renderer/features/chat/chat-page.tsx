import { useEffect, useMemo, useRef, useState } from "react"
import {
  Briefcase01Icon,
  BubbleChatIcon,
  Github01Icon,
  Home07Icon,
  Contact01Icon,
  Loading03Icon,
  Logout03Icon,
  MoreHorizontalIcon,
  SentIcon,
  Settings02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button as BeButton } from "@/components/motion/button/base"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { DesktopConversation, DesktopMessage } from "../../../shared/account-data"
import type { ServerCatalog } from "../../../shared/auth"
import {
  JIYING_HOMEPAGE,
  MAGICCHAT_REPOSITORY,
  type ThemePreference,
} from "../../../shared/desktop"

type AppSection = "chat" | "contacts" | "projects"

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
  const historyRef = useRef<HTMLDivElement>(null)
  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId],
  )

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
  }, [showToast, targetId])

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
  }, [selectedId, showToast, targetId])

  useEffect(() => {
    if (!selected || loadingMessages) return
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight })
  }, [loadingMessages, messages, selected])

  return (
    <main className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
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
          <aside className="flex min-h-0 flex-col border-r bg-sidebar">
            <header className="flex h-16 shrink-0 items-center justify-between border-b px-5">
              <div>
                <h1 className="font-semibold">消息</h1>
                <p className="text-xs text-muted-foreground">即应 Chat</p>
              </div>
              <BeButton type="button" variant="ghost" size="icon" aria-label="更多操作">
                <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden />
              </BeButton>
            </header>

            <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="对话列表">
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
                <ul className="space-y-1">
                  {conversations.map((conversation) => {
                    const active = conversation.id === selectedId
                    return (
                      <li key={conversation.id}>
                        <BeButton
                          type="button"
                          variant="ghost"
                          size="md"
                          className={cn(
                            "h-auto w-full justify-start rounded-lg p-3 text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            active && "bg-sidebar-accent text-sidebar-accent-foreground",
                          )}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setSelectedId(conversation.id)}
                        >
                          <EntityAvatar
                            targetId={targetId}
                            type={conversation.avatarType}
                            id={conversation.avatarId}
                            theme={resolvedTheme}
                            size={40}
                            label={`${conversation.name}头像`}
                          />
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{conversation.name}</span>
                              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                                {formatConversationTime(conversation.lastMessageAt)}
                              </span>
                            </span>
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              {conversation.lastMessageSummary || "暂无消息"}
                            </span>
                          </span>
                        </BeButton>
                      </li>
                    )
                  })}
                </ul>
              )}
            </nav>
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
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <span className="flex size-14 items-center justify-center rounded-full bg-muted">
                  <HugeiconsIcon icon={BubbleChatIcon} className="size-6" aria-hidden />
                </span>
                <div className="space-y-1">
                  <h2 className="font-medium text-foreground">选择一个对话</h2>
                  <p className="text-sm">从左侧选择对话后开始聊天</p>
                </div>
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

function SectionPlaceholder({ section }: { section: Exclude<AppSection, "chat"> }) {
  const content =
    section === "contacts"
      ? { label: "通讯录", icon: Contact01Icon }
      : { label: "项目", icon: Briefcase01Icon }
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
            className="group/avatar-trigger mb-6 flex size-10 shrink-0 items-center justify-center rounded-lg bg-xgui-background-1/10 outline-none transition-colors hover:bg-xgui-background-1/20 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-xgui-background-1/20 dark:bg-xgui-background-1/20 dark:hover:bg-xgui-background-1/30 dark:data-[state=open]:bg-xgui-background-1/30"
          >
            <EntityAvatar
              targetId={targetId}
              type="user"
              id={userId}
              theme={resolvedTheme}
              size={36}
              label={`${userName}头像`}
              className="rounded-lg"
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
              className="row-span-2 rounded-lg"
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
    { id: "chat", label: "聊天", icon: BubbleChatIcon },
    { id: "contacts", label: "通讯录", icon: Contact01Icon },
    { id: "projects", label: "项目", icon: Briefcase01Icon },
  ] as const

  async function openExternal(destination: "homepage" | "repository") {
    const url = destination === "homepage" ? JIYING_HOMEPAGE : MAGICCHAT_REPOSITORY
    if (!window.desktop) {
      window.open(url, "_blank", "noopener,noreferrer")
      return
    }
    try {
      const result =
        destination === "homepage"
          ? await window.desktop.openHomepage()
          : await window.desktop.openExternalLink(url)
      if (!result.ok) {
        showToast({ status: "error", title: "无法打开链接", description: result.error.message })
      }
    } catch {
      showToast({ status: "error", title: "无法打开链接，请稍后重试" })
    }
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center bg-xgui-background-4 py-3">
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
                "rounded-full text-white hover:bg-white/10 hover:text-white",
                active && "bg-xgui-brand hover:bg-xgui-brand",
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

      <div className="mb-2 flex flex-col gap-2">
        <BeButton
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-lg text-white hover:bg-white/10 hover:text-white"
          aria-label="即应官网"
          title="即应官网"
          onClick={() => void openExternal("homepage")}
        >
          <HugeiconsIcon icon={Home07Icon} aria-hidden />
        </BeButton>
        <BeButton
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-lg text-white hover:bg-white/10 hover:text-white"
          aria-label="GitHub 开源仓库"
          title="GitHub 开源仓库"
          onClick={() => void openExternal("repository")}
        >
          <HugeiconsIcon icon={Github01Icon} aria-hidden />
        </BeButton>
      </div>

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
            className="rounded-lg text-white hover:bg-white/10 hover:text-white"
            aria-label="设置"
            title="设置"
          >
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} aria-hidden />
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
