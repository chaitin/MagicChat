import { useEffect, useState } from "react"
import {
  AppleReminderIcon,
  ChatIcon,
  ContentWritingIcon,
  CrosshairIcon,
  FloppyDiskIcon,
  FolderClosedIcon,
  FlashIcon,
  Home07Icon,
  Loading03Icon,
  Logout03Icon,
  PowerIcon,
  Settings02Icon,
  UserIcon,
  UserSquareIcon,
} from "@hugeicons/core-free-icons"
import type { ServerCatalog } from "../../../../shared/auth"
import { JIYING_HOMEPAGE, type ThemePreference } from "../../../../shared/desktop"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { AvatarBadge } from "@/components/ui/avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
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
import { cn } from "@/lib/utils"

export type AppSection =
  | "chat"
  | "contacts"
  | "projects"
  | "goals"
  | "documents"
  | "tasks"
  | "drive"

export function SectionPlaceholder({ section }: { section: Exclude<AppSection, "chat"> }) {
  const label = {
    contacts: "通讯录",
    projects: "项目管理",
    goals: "目标管理",
    documents: "文档",
    tasks: "任务",
    drive: "云网盘",
  }[section]
  return (
    <section
      aria-label={`${label}（功能尚未接入）`}
      className="flex min-w-0 flex-1 items-center justify-center bg-card text-xgui-background-2"
    >
      <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
        <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
      </span>
    </section>
  )
}

export function AppRail({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  activeSection,
  hasUnreadMessages,
  onSectionChange,
  onSignOut,
  onRequestQuit,
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
  hasUnreadMessages: boolean
  onSectionChange: (section: AppSection) => void
  onSignOut: () => Promise<boolean>
  onRequestQuit: () => void
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
        onRequestQuit={onRequestQuit}
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
                "relative rounded-full hover:bg-foreground/10",
                active && "bg-xgui-brand text-background hover:bg-xgui-brand hover:text-background",
              )}
              aria-label={item.id === "chat" && hasUnreadMessages ? "聊天，有未读消息" : item.label}
              aria-current={active ? "page" : undefined}
              title={item.label}
              onClick={() => onSectionChange(item.id)}
            >
              <HugeiconsIcon icon={item.icon} aria-hidden />
              {item.id === "chat" && hasUnreadMessages && (
                <AvatarBadge
                  className="pointer-events-none top-0.5 right-0.5 bottom-auto size-2! bg-xgui-destructive"
                  aria-hidden="true"
                />
              )}
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

function AccountMenu({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  onSignOut,
  onRequestQuit,
}: {
  targetId: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  onSignOut: () => Promise<boolean>
  onRequestQuit: () => void
}) {
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)

  useEffect(() => window.desktop?.onRequestSignOut(() => setLogoutOpen(true)), [])

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
          <DropdownMenuItem variant="destructive" onSelect={onRequestQuit}>
            <HugeiconsIcon icon={PowerIcon} className="size-4" aria-hidden />
            关闭即应
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
