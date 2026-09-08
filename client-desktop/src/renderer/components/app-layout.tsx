import {
  BriefcaseBusiness,
  CircleUserRound,
  House,
  Loader2Icon,
  LogOut,
  MessageCircleMore,
  Moon,
  Palette,
  Settings,
  Sun,
  SunMoon,
  UserRound,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { NavLink, Outlet, useNavigate } from "react-router"
import { toast } from "sonner"

import { ProfileSettingsDialog } from "@/components/profile-settings-dialog"
import type { CroppedAvatar } from "@/components/custom-avatar-picker"
import { useTheme } from "@/components/theme-provider"
import { useLocale } from "@/components/locale-provider"
import { UserSettingsDialog } from "@/components/user-settings-dialog"
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
import { NotificationDot } from "@/components/ui/notification-dot"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { clientLogout } from "@/lib/client-auth"
import { openHostSettings, setHostBadge, setHostTrayMessages } from "@/lib/desktop-host"
import { selectUnreadTrayMessages } from "@/lib/tray-messages"
import { getNotifiableUnreadCount, getTotalUnreadCount } from "@/lib/conversation-notifications"
import { updateCurrentClientUser, uploadCurrentClientAvatar } from "@/lib/client-data-api"
import type { ClientUser } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { useAppInfo } from "@/lib/app-info-context"
import { cn } from "@/lib/utils"
import { useDesktopSettings } from "@/hooks/use-desktop-settings"

const navItems = [
  { label: "nav.chat", to: "/chat", icon: MessageCircleMore },
  { label: "nav.contacts", to: "/contacts", icon: CircleUserRound },
  { label: "nav.projects", to: "/projects", icon: BriefcaseBusiness },
] as const

const themeItems = [
  { value: "system", label: "nav.theme.system", icon: SunMoon },
  { value: "light", label: "nav.theme.light", icon: Sun },
  { value: "dark", label: "nav.theme.dark", icon: Moon },
  { value: "blue", label: "nav.theme.blue", icon: Palette },
  { value: "violet", label: "nav.theme.violet", icon: Palette },
  { value: "rose", label: "nav.theme.rose", icon: Palette },
  { value: "amber", label: "nav.theme.amber", icon: Palette },
  { value: "emerald", label: "nav.theme.emerald", icon: Palette },
] as const

type ThemeValue = (typeof themeItems)[number]["value"]

export function AppLayout({ footerAction }: { footerAction?: ReactNode }) {
  const { t } = useLocale()
  const {
    clearMessageScope,
    conversations,
    incomingFriendRequests = [],
    me,
    refreshMe,
  } = useClientData()
  const totalUnreadCount = getTotalUnreadCount(conversations)
  const notifiableUnreadCount = getNotifiableUnreadCount(conversations)
  const hasUnreadMessages = totalUnreadCount > 0
  const pendingIncomingFriendRequestCount = incomingFriendRequests.filter(
    (request) => request.status === "pending",
  ).length
  const trayMessages = useMemo(() => selectUnreadTrayMessages(conversations), [conversations])
  const messageNotificationsEnabled = useDesktopSettings()?.messageNotificationsEnabled ?? true
  useEffect(() => {
    if (messageNotificationsEnabled) {
      setHostBadge(notifiableUnreadCount)
      setHostTrayMessages(trayMessages)
    } else {
      setHostBadge(0)
      setHostTrayMessages([])
    }
    return () => {
      setHostBadge(0)
      setHostTrayMessages([])
    }
  }, [messageNotificationsEnabled, notifiableUnreadCount, trayMessages])
  const [notificationAnimation, setNotificationAnimation] = useState({
    active: false,
    unreadCount: totalUnreadCount,
    version: 0,
  })

  if (notificationAnimation.unreadCount !== totalUnreadCount) {
    const unreadCountIncreased = totalUnreadCount > notificationAnimation.unreadCount

    setNotificationAnimation({
      active: unreadCountIncreased,
      unreadCount: totalUnreadCount,
      version: unreadCountIncreased
        ? notificationAnimation.version + 1
        : notificationAnimation.version,
    })
  }

  function handleNotificationAnimationEnd() {
    setNotificationAnimation((current) =>
      current.active ? { ...current, active: false } : current,
    )
  }

  return (
    <div className="app-layout-shell workspace-shell flex h-svh min-h-0 bg-background text-foreground">
      <aside className="app-navigation-rail flex w-12 shrink-0 flex-col items-center border-r bg-sidebar py-3">
        <UserAvatarMenu clearMessageScope={clearMessageScope} user={me} refreshMe={refreshMe} />
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-2">
          {navItems.map((item) => (
            <MainNavItem
              key={item.to}
              item={item}
              showNotification={
                (item.to === "/chat" && hasUnreadMessages) ||
                (item.to === "/contacts" && pendingIncomingFriendRequestCount > 0)
              }
              notificationAccessibleLabel={
                item.to === "/chat" && hasUnreadMessages
                  ? t("nav.unread", { label: t(item.label) })
                  : item.to === "/contacts" && pendingIncomingFriendRequestCount > 0
                    ? t("nav.friendRequests", { label: t(item.label) })
                    : undefined
              }
              notificationAnimationActive={item.to === "/chat" && notificationAnimation.active}
              notificationAnimationVersion={notificationAnimation.version}
              onNotificationAnimationEnd={handleNotificationAnimationEnd}
            />
          ))}
        </nav>
        <div className="flex flex-col items-center gap-2">
          {footerAction}
          <ProductWebsiteLink />
          <GithubLink />
          <ThemeSwitcher />
          <SidebarSettingsButton />
        </div>
      </aside>
      <Outlet />
    </div>
  )
}

function ProductWebsiteLink() {
  const { t } = useLocale()
  return (
    <Button
      asChild
      className="rounded-md hover:bg-transparent hover:text-primary dark:hover:bg-transparent"
      size="icon-sm"
      variant="ghost"
    >
      <a
        aria-label={t("nav.website")}
        href="https://jiying.chat/"
        rel="noopener noreferrer"
        target="_blank"
        title={t("nav.website.short")}
      >
        <House aria-hidden="true" className="size-5" />
      </a>
    </Button>
  )
}

function UserAvatarMenu({
  clearMessageScope,
  refreshMe,
  user,
}: {
  clearMessageScope: () => void
  refreshMe: () => Promise<void>
  user: ClientUser
}) {
  const { t } = useLocale()
  const navigate = useNavigate()
  const { setAuthenticated } = useAppInfo()
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const displayName = getUserDisplayName(user)

  async function handleLogout() {
    setLogoutPending(true)

    try {
      await clientLogout()
      clearMessageScope()
      setAuthenticated(false)
      navigate("/login", { replace: true })
    } catch (error) {
      setLogoutConfirmOpen(false)
      toast.error(getLogoutErrorMessage(error, t))
    } finally {
      setLogoutPending(false)
    }
  }

  async function handleAvatarSave(avatar: string) {
    try {
      await updateCurrentClientUser({ avatar })
      await refreshMe()
      toast.success(t("user.avatarSaved"))
    } catch (error) {
      toast.error(getProfileUpdateErrorMessage(error, t))
      throw error
    }
  }

  async function handleCustomAvatarSave(avatar: CroppedAvatar) {
    try {
      const updatedUser = await uploadCurrentClientAvatar(avatar.file)
      await refreshMe()
      toast.success(t("user.avatarSaved"))
      return updatedUser.avatar
    } catch (error) {
      toast.error(getProfileUpdateErrorMessage(error, t))
      throw error
    }
  }

  async function handleNicknameSave(nickname: string) {
    try {
      await updateCurrentClientUser({ nickname })
      await refreshMe()
      toast.success(t("user.nicknameSaved"))
    } catch (error) {
      toast.error(getProfileUpdateErrorMessage(error, t))
      throw error
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("user.menu")}
            className="group/avatar-trigger mb-6 rounded-sm bg-muted transition-colors outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-background"
            size="icon"
            title={displayName}
            type="button"
            variant="ghost"
          >
            <Avatar className="size-9 rounded-sm bg-muted group-hover/avatar-trigger:bg-background group-data-[state=open]/avatar-trigger:bg-background after:rounded-sm after:transition-colors group-hover/avatar-trigger:after:border-ring group-data-[state=open]/avatar-trigger:after:border-ring">
              {user.avatar && (
                <AvatarImage alt={displayName} className="rounded-sm" src={user.avatar} />
              )}
              <AvatarFallback className="rounded-sm text-sm">
                {getAvatarInitial(displayName)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <UserMenuProfileSummary user={user} />
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserRound className="size-4" />
            {t("user.profile")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={logoutPending}
            onSelect={() => setLogoutConfirmOpen(true)}
            variant="destructive"
          >
            <LogOut className="size-4" />
            {t("user.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        <ProfileSettingsDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          onAvatarSave={handleAvatarSave}
          onCustomAvatarSave={handleCustomAvatarSave}
          onNicknameSave={handleNicknameSave}
          user={user}
        />
      </DropdownMenu>

      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("user.logout.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("user.logout.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutPending}>{t("user.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={logoutPending}
              onClick={(event) => {
                event.preventDefault()
                void handleLogout()
              }}
              variant="destructive"
            >
              {logoutPending && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {t("user.logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SidebarSettingsButton() {
  const { t } = useLocale()
  const [settingsOpen, setSettingsOpen] = useState(false)

  function handleSettingsOpen() {
    if (!openHostSettings()) setSettingsOpen(true)
  }

  return (
    <>
      <Button
        aria-label={t("user.settings")}
        className="rounded-md hover:bg-transparent hover:text-primary aria-expanded:bg-transparent aria-expanded:text-primary dark:hover:bg-transparent"
        onClick={handleSettingsOpen}
        size="icon-sm"
        title={t("user.settings")}
        type="button"
        variant="ghost"
      >
        <Settings className="size-5" />
      </Button>
      <UserSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

function UserMenuProfileSummary({ user }: { user: ClientUser }) {
  const { t } = useLocale()
  const displayName = getUserDisplayName(user)
  const contactText = user.email || user.phone || t("user.contactNotSet")

  return (
    <div
      aria-label={t("user.info")}
      className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 px-2 py-3"
      role="group"
    >
      <Avatar className="row-span-2 size-12 rounded-full bg-muted after:rounded-full">
        {user.avatar && (
          <AvatarImage alt={displayName} className="rounded-full" src={user.avatar} />
        )}
        <AvatarFallback className="rounded-full text-base">
          {getAvatarInitial(displayName)}
        </AvatarFallback>
      </Avatar>

      <div
        aria-label={t("user.nameInfo")}
        className="flex min-w-0 items-center gap-1.5 text-sm font-semibold"
        role="group"
      >
        <span className="min-w-0 truncate">{displayName}</span>
      </div>

      <div
        aria-label={t("user.contactInfo")}
        className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        role="group"
      >
        <span className="min-w-0 truncate">{contactText}</span>
      </div>
    </div>
  )
}

function MainNavItem({
  item,
  notificationAnimationActive,
  notificationAnimationVersion,
  notificationAccessibleLabel,
  onNotificationAnimationEnd,
  showNotification,
}: {
  item: (typeof navItems)[number]
  notificationAnimationActive: boolean
  notificationAnimationVersion: number
  notificationAccessibleLabel?: string
  onNotificationAnimationEnd: () => void
  showNotification: boolean
}) {
  const { t } = useLocale()
  const Icon = item.icon
  const label = t(item.label)
  const accessibleLabel = notificationAccessibleLabel ?? label

  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className="workspace-nav-item relative focus-visible:border-transparent focus-visible:ring-0"
    >
      <NavLink to={item.to} aria-label={accessibleLabel} title={label}>
        <Icon
          className="size-5 [stroke-width:2] transition-[stroke-width] group-hover/button:[stroke-width:2.5]"
          strokeWidth={2}
        />
        <span className="workspace-nav-label" aria-hidden="true">
          {label}
        </span>
        {showNotification && (
          <NotificationDot
            key={notificationAnimationVersion}
            className={cn(
              "absolute top-1 right-1 ring-sidebar",
              notificationAnimationActive && "notification-dot-flash",
            )}
            onAnimationEnd={onNotificationAnimationEnd}
          />
        )}
      </NavLink>
    </Button>
  )
}

function GithubLink() {
  const { t } = useLocale()
  return (
    <Button
      asChild
      className="rounded-md hover:bg-transparent hover:text-primary dark:hover:bg-transparent"
      size="icon-sm"
      variant="ghost"
    >
      <a
        aria-label={t("nav.github")}
        href="https://github.com/chaitin/MagicChat"
        rel="noopener noreferrer"
        target="_blank"
        title="GitHub"
      >
        <GithubIcon className="size-5" />
      </a>
    </Button>
  )
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23A11.5 11.5 0 0 1 12 6.847c1.02.005 2.045.138 3.003.404 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57A12.02 12.02 0 0 0 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function ThemeSwitcher() {
  const { t } = useLocale()
  const { theme, setTheme } = useTheme()
  const currentTheme = themeItems.find((item) => item.value === theme) ?? themeItems[0]
  const CurrentIcon = currentTheme.icon

  function handleThemeChange(value: string) {
    if (isThemeValue(value)) {
      setTheme(value)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-md hover:bg-transparent hover:text-primary aria-expanded:bg-transparent aria-expanded:text-primary data-[state=open]:bg-transparent data-[state=open]:text-primary dark:hover:bg-transparent"
          aria-label={t("nav.theme", { label: t(currentTheme.label) })}
          title={t("nav.theme", { label: t(currentTheme.label) })}
        >
          <CurrentIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme} onValueChange={handleThemeChange}>
          {themeItems.map((item) => {
            const Icon = item.icon

            return (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                <Icon className="size-4" />
                {t(item.label)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function isThemeValue(value: string): value is ThemeValue {
  return themeItems.some((item) => item.value === value)
}

function getUserDisplayName(user: { name: string; nickname: string }) {
  return user.nickname || user.name
}

function getAvatarInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function getLogoutErrorMessage(error: unknown, t: ReturnType<typeof useLocale>["t"]) {
  if (error instanceof Error) {
    return error.message
  }

  return t("user.logoutError")
}

function getProfileUpdateErrorMessage(error: unknown, t: ReturnType<typeof useLocale>["t"]) {
  if (error instanceof Error) {
    return error.message
  }

  return t("user.profileUpdateError")
}
