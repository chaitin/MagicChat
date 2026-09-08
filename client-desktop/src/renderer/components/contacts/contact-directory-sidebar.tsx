import { Children, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import {
  Blocks,
  Bot,
  ChevronRight,
  Loader2Icon,
  MessageCircle,
  RefreshCw,
  Search,
  UserPlus,
} from "lucide-react"

import type { DirectorySelection, DirectoryTab } from "@/components/contacts/contact-directory"
import { directoryItemKey } from "@/components/contacts/contact-directory"
import { AppCredentialsDialog } from "@/components/contacts/app-credentials-dialog"
import { CreateAppDialog } from "@/components/contacts/create-app-dialog"
import { GroupAvatar } from "@/components/group-avatar"
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useLocale } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarHeader,
  SidebarInput,
  SidebarMenuAction,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VirtualList } from "@/components/ui/virtual-list"
import type { ContactApp, ContactGroup, ContactUser } from "@/lib/client-data-api"
import type { ClientAppCredentials } from "@/lib/client-api/apps"
import { cn } from "@/lib/utils"

export function ContactDirectorySidebar({
  activeKeyword,
  activeSelection,
  activeTab,
  appGrantUsers,
  apps,
  contacts,
  directoryMode = "organization",
  contactsRefreshing,
  currentUserId,
  groups,
  incomingPendingFriendRequestCount = 0,
  organizationName,
  onActiveTabChange,
  onKeywordChange,
  onRefresh,
  onOpenFriendManagement,
  onSelect,
  onStartAppConversation,
  onStartContactConversation,
  onStartGroupConversation,
  openingDirectoryItemKey,
}: {
  activeKeyword: string
  activeSelection: DirectorySelection | null
  activeTab: DirectoryTab
  appGrantUsers: ContactUser[]
  apps: ContactApp[]
  contacts: ContactUser[]
  directoryMode?: "friends" | "organization"
  contactsRefreshing: boolean
  currentUserId: string
  groups: ContactGroup[]
  incomingPendingFriendRequestCount?: number
  organizationName: string
  onActiveTabChange: (tab: DirectoryTab) => void
  onKeywordChange: (keyword: string) => void
  onRefresh: () => void
  onOpenFriendManagement?: () => void
  onSelect: (selection: DirectorySelection) => void
  onStartAppConversation: (app: ContactApp) => void
  onStartContactConversation: (contact: ContactUser) => void
  onStartGroupConversation: (group: ContactGroup) => void
  openingDirectoryItemKey: string
}) {
  const { t } = useLocale()
  const [createAppDialogOpen, setCreateAppDialogOpen] = useState(false)
  const [createdAppCredentials, setCreatedAppCredentials] = useState<ClientAppCredentials | null>(
    null,
  )
  const userScrollRef = useRef<HTMLDivElement>(null)
  const appScrollRef = useRef<HTMLDivElement>(null)
  const groupScrollRef = useRef<HTMLDivElement>(null)
  const activeTabLabel = getDirectoryTabLabel(activeTab, t)
  const normalizedCurrentUserId = currentUserId.toLowerCase()
  const builtInApps = apps.filter((app) => app.creatorUserId === null)
  const ownedApps = apps.filter(
    (app) => app.creatorUserId?.toLowerCase() === normalizedCurrentUserId,
  )
  const otherApps = apps.filter(
    (app) =>
      app.creatorUserId !== null && app.creatorUserId.toLowerCase() !== normalizedCurrentUserId,
  )
  const joinedGroups = groups.filter((group) => group.joined)
  const publicGroups = groups.filter((group) => group.visibility === "public")

  return (
    <Sidebar className="workspace-section-sidebar border-r bg-background" collapsible="none">
      <SidebarHeader className="gap-0 p-0">
        <div
          className="workspace-section-heading flex h-14 items-center justify-between px-4"
          data-desktop-drag-region="true"
        >
          <h1 className="text-base font-medium">
            {directoryMode === "friends" ? t("contacts.friendsTitle") : t("contacts.title")}
          </h1>
          <div className="flex items-center gap-1">
            {directoryMode === "friends" && onOpenFriendManagement && (
              <span className="relative">
                <Button
                  aria-label={
                    incomingPendingFriendRequestCount > 0
                      ? t("contacts.newFriendsAria", {
                          count: incomingPendingFriendRequestCount,
                        })
                      : t("contacts.newFriends")
                  }
                  onClick={onOpenFriendManagement}
                  size="icon-sm"
                  title={t("contacts.newFriends")}
                  type="button"
                  variant="ghost"
                >
                  <UserPlus className="size-4" />
                </Button>
                {incomingPendingFriendRequestCount > 0 && (
                  <Badge
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-1 -right-1 h-4 min-w-4 justify-center bg-red-500 px-1 py-0 text-[10px] leading-4 font-normal text-white hover:bg-red-500 dark:bg-red-500"
                    variant="destructive"
                  >
                    {formatPendingFriendRequestCount(incomingPendingFriendRequestCount)}
                  </Badge>
                )}
              </span>
            )}
            <Button
              aria-label={t("contacts.refresh")}
              disabled={contactsRefreshing}
              onClick={onRefresh}
              size="icon-sm"
              title={t("contacts.refresh")}
              type="button"
              variant="ghost"
            >
              <RefreshCw className={cn("size-4", contactsRefreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
      </SidebarHeader>
      <Tabs
        className="min-h-0 flex-1 gap-0"
        onValueChange={(value) => onActiveTabChange(value as DirectoryTab)}
        value={activeTab}
      >
        <div className="px-4 pb-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="user">{t("contacts.tab.users")}</TabsTrigger>
            <TabsTrigger value="app">{t("contacts.tab.apps")}</TabsTrigger>
            <TabsTrigger value="group">{t("contacts.tab.groups")}</TabsTrigger>
          </TabsList>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              aria-label={t("contacts.search", { label: activeTabLabel })}
              className="pl-8"
              onChange={(event) => onKeywordChange(event.target.value)}
              placeholder={t("contacts.search", { label: activeTabLabel })}
              type="search"
              value={activeKeyword}
            />
          </div>
        </div>
        <TabsContent
          className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
          ref={userScrollRef}
          value="user"
        >
          <div className="flex flex-col gap-2">
            <DirectorySectionCollapsible
              defaultOpen={contacts.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              count={contacts.length}
              title={directoryMode === "friends" ? t("contacts.friendsTitle") : organizationName}
            >
              <DirectoryList
                ariaLabel={t("contacts.list", {
                  name: directoryMode === "friends" ? t("contacts.friendsTitle") : organizationName,
                })}
                scrollRef={userScrollRef}
              >
                {contacts.map((contact) => (
                  <ContactListItem
                    key={contact.id}
                    contact={contact}
                    canStartConversation={contact.id !== currentUserId}
                    size="sm"
                    selected={isDirectorySelection(activeSelection, "user", contact.id)}
                    onSelect={() => onSelect({ id: contact.id, type: "user" })}
                    onStartConversation={() => onStartContactConversation(contact)}
                    startingConversation={
                      openingDirectoryItemKey === directoryItemKey("user", contact.id)
                    }
                  />
                ))}
                {contacts.length === 0 && (
                  <DirectoryEmptyState
                    label={t("contacts.empty", {
                      name:
                        directoryMode === "friends" ? t("contacts.friendsTitle") : organizationName,
                    })}
                  />
                )}
              </DirectoryList>
            </DirectorySectionCollapsible>
          </div>
        </TabsContent>
        <TabsContent
          className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
          ref={appScrollRef}
          value="app"
        >
          <div className="flex flex-col gap-2">
            <DirectorySectionCollapsible
              count={builtInApps.length}
              defaultOpen={builtInApps.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              title={t("contacts.builtinApps")}
            >
              <AppDirectoryList
                activeSelection={activeSelection}
                apps={builtInApps}
                ariaLabel={t("contacts.builtinAppsList")}
                onSelect={onSelect}
                onStartAppConversation={onStartAppConversation}
                openingDirectoryItemKey={openingDirectoryItemKey}
                scrollRef={appScrollRef}
              />
            </DirectorySectionCollapsible>

            <DirectorySectionCollapsible
              count={ownedApps.length}
              defaultOpen={ownedApps.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              title={t("contacts.myApps")}
            >
              <AppDirectoryList
                activeSelection={activeSelection}
                apps={ownedApps}
                ariaLabel={t("contacts.myAppsList")}
                onSelect={onSelect}
                onStartAppConversation={onStartAppConversation}
                openingDirectoryItemKey={openingDirectoryItemKey}
                scrollRef={appScrollRef}
              />
              <div className="px-2 pb-2">
                <Button
                  className="w-full"
                  onClick={() => setCreateAppDialogOpen(true)}
                  type="button"
                  variant="secondary"
                >
                  <Blocks />
                  {t("contacts.createApp")}
                </Button>
              </div>
            </DirectorySectionCollapsible>

            <DirectorySectionCollapsible
              count={otherApps.length}
              defaultOpen={otherApps.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              title={t("contacts.otherApps")}
            >
              <AppDirectoryList
                activeSelection={activeSelection}
                apps={otherApps}
                ariaLabel={t("dir.otherAppsList")}
                onSelect={onSelect}
                onStartAppConversation={onStartAppConversation}
                openingDirectoryItemKey={openingDirectoryItemKey}
                scrollRef={appScrollRef}
              />
            </DirectorySectionCollapsible>
          </div>
        </TabsContent>
        <TabsContent
          className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3"
          ref={groupScrollRef}
          value="group"
        >
          <div className="flex flex-col gap-2">
            <DirectorySectionCollapsible
              count={joinedGroups.length}
              defaultOpen={joinedGroups.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              title={t("dir.joined")}
            >
              <GroupDirectoryList
                activeSelection={activeSelection}
                ariaLabel={t("dir.joinedList")}
                groups={joinedGroups}
                onSelect={onSelect}
                onStartGroupConversation={onStartGroupConversation}
                openingDirectoryItemKey={openingDirectoryItemKey}
                scrollRef={groupScrollRef}
              />
            </DirectorySectionCollapsible>

            <DirectorySectionCollapsible
              count={publicGroups.length}
              defaultOpen={publicGroups.length > 0}
              forceOpen={Boolean(activeKeyword.trim())}
              title={t("dir.public")}
            >
              <GroupDirectoryList
                activeSelection={activeSelection}
                ariaLabel={t("dir.publicList")}
                groups={publicGroups}
                onSelect={onSelect}
                onStartGroupConversation={onStartGroupConversation}
                openingDirectoryItemKey={openingDirectoryItemKey}
                scrollRef={groupScrollRef}
              />
            </DirectorySectionCollapsible>
          </div>
        </TabsContent>
      </Tabs>
      <CreateAppDialog
        currentUserId={currentUserId}
        onCreated={(credentials) => {
          setCreatedAppCredentials(credentials)
          onRefresh()
        }}
        onOpenChange={setCreateAppDialogOpen}
        open={createAppDialogOpen}
        users={appGrantUsers}
      />
      <AppCredentialsDialog
        credentials={createdAppCredentials}
        onCredentialsChange={(credentials) => {
          setCreatedAppCredentials(credentials)
          onRefresh()
        }}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedAppCredentials(null)
          }
        }}
        open={createdAppCredentials !== null}
      />
    </Sidebar>
  )
}

function formatPendingFriendRequestCount(count: number) {
  return count > 99 ? "99+" : String(count)
}

function DirectoryList({
  ariaLabel,
  children,
  scrollRef,
}: {
  ariaLabel: string
  children: ReactNode
  scrollRef: React.RefObject<HTMLElement | null>
}) {
  const items = Children.toArray(children)
  return (
    <VirtualList
      ariaLabel={ariaLabel}
      className="flex flex-col gap-1 px-2 pb-3"
      estimateSize={48}
      items={items}
      renderItem={(item) => item}
      role="listbox"
      scrollRef={scrollRef}
    />
  )
}

function DirectorySectionCollapsible({
  children,
  count,
  defaultOpen = false,
  forceOpen = false,
  title,
}: {
  children: ReactNode
  count: number
  defaultOpen?: boolean
  forceOpen?: boolean
  title: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const previousCount = useRef(count)
  const visible = forceOpen || open

  useEffect(() => {
    if (forceOpen) {
      return
    }

    const lastCount = previousCount.current
    previousCount.current = count
    if (lastCount === 0 && count > 0) {
      setOpen(true)
    } else if (lastCount > 0 && count === 0) {
      setOpen(false)
    }
  }, [count, forceOpen])

  return (
    <Collapsible
      className="mx-4 overflow-hidden rounded-md border"
      onOpenChange={(nextOpen) => {
        if (!forceOpen) {
          setOpen(nextOpen)
        }
      }}
      open={visible}
    >
      <CollapsibleTrigger asChild>
        <Button
          aria-label={title}
          className="w-full justify-between rounded-none px-4 hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
          size="lg"
          type="button"
          variant="ghost"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight
              className={cn("size-4 shrink-0 transition-transform", visible && "rotate-90")}
            />
            <span className="truncate">{title}</span>
          </span>
          <Badge variant="secondary">{count}</Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

function GroupDirectoryList({
  activeSelection,
  ariaLabel,
  groups,
  onSelect,
  onStartGroupConversation,
  openingDirectoryItemKey,
  scrollRef,
}: {
  activeSelection: DirectorySelection | null
  ariaLabel: string
  groups: ContactGroup[]
  onSelect: (selection: DirectorySelection) => void
  onStartGroupConversation: (group: ContactGroup) => void
  openingDirectoryItemKey: string
  scrollRef: React.RefObject<HTMLElement | null>
}) {
  return (
    <DirectoryList ariaLabel={ariaLabel} scrollRef={scrollRef}>
      {groups.map((group) => (
        <GroupListItem
          key={group.id}
          group={group}
          selected={isDirectorySelection(activeSelection, "group", group.id)}
          onSelect={() => onSelect({ id: group.id, type: "group" })}
          onStartConversation={() => onStartGroupConversation(group)}
          startingConversation={openingDirectoryItemKey === directoryItemKey("group", group.id)}
        />
      ))}
      {groups.length === 0 && <DirectoryEmptyState label={ariaLabel} />}
    </DirectoryList>
  )
}

function AppDirectoryList({
  activeSelection,
  apps,
  ariaLabel,
  onSelect,
  onStartAppConversation,
  openingDirectoryItemKey,
  scrollRef,
}: {
  activeSelection: DirectorySelection | null
  apps: ContactApp[]
  ariaLabel: string
  onSelect: (selection: DirectorySelection) => void
  onStartAppConversation: (app: ContactApp) => void
  openingDirectoryItemKey: string
  scrollRef: React.RefObject<HTMLElement | null>
}) {
  return (
    <DirectoryList ariaLabel={ariaLabel} scrollRef={scrollRef}>
      {apps.map((app) => (
        <AppListItem
          key={app.id}
          app={app}
          selected={isDirectorySelection(activeSelection, "app", app.id)}
          onSelect={() => onSelect({ id: app.id, type: "app" })}
          onStartConversation={() => onStartAppConversation(app)}
          startingConversation={openingDirectoryItemKey === directoryItemKey("app", app.id)}
        />
      ))}
      {apps.length === 0 && <DirectoryEmptyState label={ariaLabel} />}
    </DirectoryList>
  )
}

function DirectoryEmptyState({ label }: { label: string }) {
  const { t } = useLocale()
  return (
    <div className="group/menu-item relative">
      <div className="px-3 py-8 text-center text-sm text-muted-foreground">
        {t("dir.noMatch", { label })}
      </div>
    </div>
  )
}

function AppListItem({
  app,
  onSelect,
  onStartConversation,
  selected,
  startingConversation,
}: {
  app: ContactApp
  onSelect: () => void
  onStartConversation: () => void
  selected: boolean
  startingConversation: boolean
}) {
  const { t } = useLocale()
  return (
    <DirectoryListItem
      actionDisabled={false}
      actionLabel={t("dir.talkTo", { name: app.name })}
      actionLoading={startingConversation}
      media={
        <Avatar className="rounded-sm bg-muted after:rounded-sm">
          {app.avatar && <AvatarImage alt={app.name} className="rounded-sm" src={app.avatar} />}
          <AvatarFallback className="rounded-sm">
            <Bot className="size-4" />
          </AvatarFallback>
          <ContactAvatarBadge online={app.online} />
        </Avatar>
      }
      onAction={onStartConversation}
      onSelect={onSelect}
      selected={selected}
      title={app.name}
    />
  )
}

function GroupListItem({
  group,
  onSelect,
  onStartConversation,
  selected,
  startingConversation,
}: {
  group: ContactGroup
  onSelect: () => void
  onStartConversation: () => void
  selected: boolean
  startingConversation: boolean
}) {
  const { t } = useLocale()
  return (
    <DirectoryListItem
      actionDisabled={false}
      actionLabel={
        group.joined ? t("dir.enter", { name: group.name }) : t("dir.join", { name: group.name })
      }
      actionLoading={startingConversation}
      media={
        <GroupAvatar
          avatar={group.avatar}
          className="size-8"
          members={group.avatarMembers}
          name={group.name}
        />
      }
      onAction={onStartConversation}
      onSelect={onSelect}
      selected={selected}
      title={group.name}
    />
  )
}

function ContactListItem({
  canStartConversation,
  contact,
  onSelect,
  onStartConversation,
  selected,
  startingConversation,
  size = "default",
}: {
  canStartConversation: boolean
  contact: ContactUser
  onSelect: () => void
  onStartConversation: () => void
  selected: boolean
  startingConversation: boolean
  size?: "default" | "sm"
}) {
  const { t } = useLocale()
  const displayName = getContactDisplayName(contact)
  const title = getContactItemTitle(contact)

  return (
    <DirectoryListItem
      actionLabel={canStartConversation ? t("dir.talkTo", { name: title }) : undefined}
      actionLoading={startingConversation}
      media={
        <Avatar className="rounded-sm bg-muted after:rounded-sm" data-testid="contact-avatar">
          {contact.avatar && (
            <AvatarImage alt={displayName} className="rounded-sm" src={contact.avatar} />
          )}
          <AvatarFallback className="rounded-sm">{getContactInitial(displayName)}</AvatarFallback>
          <ContactAvatarBadge online={contact.online} />
        </Avatar>
      }
      onAction={canStartConversation ? onStartConversation : undefined}
      onSelect={onSelect}
      selected={selected}
      size={size}
      title={title}
    />
  )
}

function DirectoryListItem({
  actionDisabled = false,
  actionLabel,
  actionLoading = false,
  media,
  onAction,
  onSelect,
  selected,
  size = "sm",
  title,
}: {
  actionDisabled?: boolean
  actionLabel?: string
  actionLoading?: boolean
  media: ReactNode
  onAction?: () => void
  onSelect: () => void
  selected: boolean
  size?: "default" | "sm"
  title: string
}) {
  function handleActionClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (!actionDisabled && onAction) {
      onAction()
    }
  }

  return (
    <div className="group/menu-item relative">
      <SidebarMenuButton
        aria-label={title}
        aria-selected={selected}
        className={cn(
          "gap-2.5 data-active:bg-primary/10 data-active:hover:bg-primary/10 dark:data-active:bg-primary/15 dark:data-active:hover:bg-primary/15",
          onAction && "pr-8",
          size === "sm" ? "h-11" : "h-12",
        )}
        isActive={selected}
        onClick={onSelect}
        role="option"
        size="lg"
        type="button"
      >
        {media}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          <span className="block min-w-0 truncate">{title}</span>
        </span>
      </SidebarMenuButton>
      {onAction && actionLabel && (
        <SidebarMenuAction
          aria-label={actionLabel}
          className="right-2 size-6 disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-3"
          disabled={actionLoading || actionDisabled}
          onClick={handleActionClick}
          showOnHover={!selected}
          type="button"
        >
          {actionLoading ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : (
            <MessageCircle />
          )}
        </SidebarMenuAction>
      )}
    </div>
  )
}

function ContactAvatarBadge({ online }: { online: boolean }) {
  const { t } = useLocale()
  return (
    <AvatarBadge
      aria-label={online ? t("avatar.online") : t("avatar.offline")}
      className={online ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-500"}
    />
  )
}

function isDirectorySelection(
  selection: DirectorySelection | null,
  type: DirectorySelection["type"],
  id: string,
) {
  return selection?.type === type && selection.id === id
}

function getDirectoryTabLabel(tab: DirectoryTab, t: ReturnType<typeof useLocale>["t"]) {
  if (tab === "app") {
    return t("dir.typeApp")
  }

  if (tab === "group") {
    return t("dir.typeGroup")
  }

  return t("dir.contact")
}

function getContactItemTitle(contact: { name: string; nickname: string }) {
  const nickname = contact.nickname.trim()

  return nickname || contact.name.trim()
}

function getContactDisplayName(contact: { name: string; nickname: string }) {
  return contact.nickname || contact.name
}

function getContactInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
