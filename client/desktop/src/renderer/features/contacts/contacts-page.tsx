import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight01Icon,
  CirclePlusIcon,
  FlashIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  Search01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemContent } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type {
  DesktopClientAppCredentials,
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
} from "../../../shared/account-data"
import { ClientAppDialog } from "./client-app-dialog"
import { FriendManagementDialog } from "./friend-management-dialog"

type Tab = "user" | "app" | "group"
type Selection = { type: Tab; id: string }

export function ContactsPage({
  targetId,
  userId,
  organizationName,
  resolvedTheme,
  onOpenConversation,
}: {
  targetId: string
  userId: string
  organizationName: string
  resolvedTheme: "light" | "dark"
  onOpenConversation: (conversationId: string) => void
}) {
  const { showToast } = useAnimatedToast()
  const [directory, setDirectory] = useState<DesktopContactDirectory | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [keyword, setKeyword] = useState("")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busyKey, setBusyKey] = useState("")
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [appDialog, setAppDialog] = useState<"create" | "edit" | "credentials" | null>(null)
  const [credentials, setCredentials] = useState<DesktopClientAppCredentials | null>(null)

  async function load(refresh = false) {
    if (!window.desktop) return
    refresh ? setRefreshing(true) : setLoading(true)
    const result = refresh
      ? await window.desktop.accountData.refreshContacts(targetId)
      : await window.desktop.accountData.getContacts(targetId)
    if (result.ok) {
      setDirectory(result.data)
      setSelection((current) => (current && entityFor(result.data, current) ? current : null))
    } else showToast({ title: result.error.message, status: "error" })
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    void load()
    return window.desktop?.accountData.onChanged((event) => {
      if (event.targetId === targetId && event.domains.includes("contacts")) void load()
    })
  }, [targetId])

  const sections = useMemo(() => {
    if (!directory) return []
    const query = keyword.trim().toLowerCase()
    const users = directory.users
      .filter((item) => matchesContact(item, query))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    const apps = directory.apps
      .filter((item) => matchesContact(item, query))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    const groups = directory.groups
      .filter((item) => matchesContact(item, query))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    return [
      {
        key: "users",
        label: directory.mode === "friends" ? "我的好友" : organizationName,
        type: "user" as const,
        entries: users,
      },
      {
        key: "builtin-apps",
        label: "内置应用",
        type: "app" as const,
        entries: apps.filter((item) => item.creatorUserId === null),
      },
      {
        key: "owned-apps",
        label: "我的应用",
        type: "app" as const,
        entries: apps.filter((item) => item.creatorUserId?.toLowerCase() === userId.toLowerCase()),
      },
      {
        key: "other-apps",
        label: "其他应用",
        type: "app" as const,
        entries: apps.filter(
          (item) =>
            item.creatorUserId !== null &&
            item.creatorUserId?.toLowerCase() !== userId.toLowerCase(),
        ),
      },
      {
        key: "joined-groups",
        label: "我加入的群组",
        type: "group" as const,
        entries: groups.filter((item) => item.joined),
      },
      {
        key: "public-groups",
        label: "公开群组",
        type: "group" as const,
        entries: groups.filter((item) => !item.joined),
      },
    ]
  }, [directory, keyword, organizationName, userId])

  const active = directory && selection ? entityFor(directory, selection) : null

  async function openConversation(type: Tab, id: string, joined?: boolean) {
    setBusyKey(`${type}:${id}`)
    const result = await window.desktop!.accountData.openContactConversation({
      targetId,
      type,
      id,
      joined,
    })
    setBusyKey("")
    if (!result.ok) return showToast({ title: result.error.message, status: "error" })
    onOpenConversation(result.data.id)
  }

  async function openOwnedApp(app: DesktopContactApp, mode: "edit" | "credentials") {
    setBusyKey(`app:${app.id}`)
    const result = await window.desktop!.accountData.getClientApp({ targetId, id: app.id })
    setBusyKey("")
    if (!result.ok) return showToast({ title: result.error.message, status: "error" })
    setCredentials(result.data)
    setAppDialog(mode)
  }

  return (
    <section className="grid min-w-0 flex-1 grid-cols-[19rem_minmax(0,1fr)] bg-card">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
        <header className="flex h-14 shrink-0 items-center gap-2 bg-xgui-background-0 pr-2 pl-3">
          <BeInput
            type="search"
            value={keyword}
            placeholder="搜索"
            aria-label="搜索通讯录"
            leftIcon={<HugeiconsIcon icon={Search01Icon} aria-hidden />}
            classNames={{
              root: "min-w-0 flex-1",
              field: "h-8 rounded-full border-transparent bg-background",
              input: "pl-9 text-sm",
            }}
            onChange={setKeyword}
          />
          {directory?.mode === "friends" && (
            <BeButton
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-5"
              aria-label="好友管理"
              title="好友管理"
              onClick={() => setFriendsOpen(true)}
            >
              <HugeiconsIcon icon={UserMultiple02Icon} aria-hidden />
            </BeButton>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <BeButton
                type="button"
                variant="ghost"
                size="icon"
                pressScale={1}
                whileHover={{ scale: 1 }}
                className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-5"
                aria-label="通讯录更多操作"
                title="更多操作"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden />
              </BeButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAppDialog("create")}>
                <HugeiconsIcon icon={CirclePlusIcon} aria-hidden />
                创建应用
              </DropdownMenuItem>
              <DropdownMenuItem disabled={refreshing} onSelect={() => void load(true)}>
                <HugeiconsIcon icon={RefreshIcon} aria-hidden />
                刷新
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <ScrollArea
          type="hover"
          scrollHideDelay={200}
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-xgui-background-1"
          viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
        >
          <nav className="min-h-full px-2 py-1" aria-label="通讯录列表">
            {loading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">正在加载通讯录…</p>
            ) : sections.every((section) => section.entries.length === 0) ? (
              <p className="p-4 text-center text-sm text-muted-foreground">没有匹配的内容</p>
            ) : (
              sections.map((section) => {
                if (section.entries.length === 0) return null
                const expanded = expandedSections.has(section.key)
                return (
                  <section key={section.key} aria-label={section.label}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 px-2 pt-3 pb-1 text-left text-xs text-muted-foreground hover:text-foreground"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedSections((current) => {
                          const next = new Set(current)
                          if (next.has(section.key)) next.delete(section.key)
                          else next.add(section.key)
                          return next
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className={cn("size-3 transition-transform", expanded && "rotate-90")}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{section.label}</span>
                      <span>{section.entries.length}</span>
                    </button>
                    {expanded &&
                      section.entries.map((entry) => {
                        const selected =
                          selection?.type === section.type && selection.id === entry.id
                        return (
                          <Item
                            key={`${section.type}:${entry.id}`}
                            asChild
                            variant="default"
                            size="sm"
                            className={cn(
                              "flex-nowrap border-transparent text-left hover:bg-foreground/5 hover:text-foreground",
                              selected &&
                                "bg-xgui-brand-1 text-sidebar-accent-foreground hover:bg-xgui-brand-1 hover:text-sidebar-accent-foreground",
                            )}
                          >
                            <button
                              type="button"
                              aria-current={selected ? "page" : undefined}
                              onClick={() => setSelection({ type: section.type, id: entry.id })}
                            >
                              <EntityAvatar
                                targetId={targetId}
                                type={entry.avatarType}
                                id={entry.avatarId}
                                theme={resolvedTheme}
                                label={entry.name}
                              />
                              <ItemContent className="w-0 min-w-0">
                                <span className="block truncate text-sm leading-snug font-medium">
                                  {entry.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {entrySummary(entry)}
                                </span>
                              </ItemContent>
                              {"online" in entry && entry.online && (
                                <span
                                  className="size-2 rounded-full bg-xgui-green"
                                  aria-label="在线"
                                />
                              )}
                            </button>
                          </Item>
                        )
                      })}
                  </section>
                )
              })
            )}
          </nav>
        </ScrollArea>
      </aside>

      <div className="min-w-0 overflow-y-auto bg-card px-6">
        {active ? (
          <ContactDetails
            entity={active}
            targetId={targetId}
            userId={userId}
            theme={resolvedTheme}
            busy={busyKey === `${selection!.type}:${active.id}`}
            onMessage={() =>
              void openConversation(
                selection!.type,
                active.id,
                selection!.type === "group" ? (active as DesktopContactGroup).joined : undefined,
              )
            }
            onDeleteFriend={
              selection!.type === "user" && directory?.mode === "friends" && active.id !== userId
                ? async () => {
                    if (!confirm(`确认删除好友“${active.name}”？`)) return
                    const result = await window.desktop!.accountData.deleteFriend({
                      targetId,
                      id: active.id,
                    })
                    if (!result.ok) {
                      showToast({ title: result.error.message, status: "error" })
                      return
                    }
                    setSelection(null)
                    void load(true)
                  }
                : undefined
            }
            onManageApp={
              selection!.type === "app" &&
              (active as DesktopContactApp).creatorUserId?.toLowerCase() === userId.toLowerCase()
                ? (mode) => void openOwnedApp(active as DesktopContactApp, mode)
                : undefined
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xgui-background-2">
            <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
              <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
            </span>
          </div>
        )}
      </div>

      {friendsOpen && directory && (
        <FriendManagementDialog
          targetId={targetId}
          userId={userId}
          contacts={directory.users}
          onClose={() => setFriendsOpen(false)}
          onChanged={() => void load(true)}
        />
      )}
      {appDialog && (
        <ClientAppDialog
          mode={appDialog}
          targetId={targetId}
          users={directory?.users ?? []}
          credentials={credentials}
          onClose={() => {
            setAppDialog(null)
            setCredentials(null)
          }}
          onChanged={() => void load(true)}
          onDeleted={() => {
            setSelection(null)
            void load(true)
          }}
        />
      )}
    </section>
  )
}

function ContactDetails({
  entity,
  targetId,
  userId,
  theme,
  busy,
  onMessage,
  onManageApp,
  onDeleteFriend,
}: {
  entity: DesktopContactUser | DesktopContactApp | DesktopContactGroup
  targetId: string
  userId: string
  theme: "light" | "dark"
  busy: boolean
  onMessage: () => void
  onManageApp?: (mode: "edit" | "credentials") => void
  onDeleteFriend?: () => void
}) {
  const isUser = entity.avatarType === "user"
  const isGroup = entity.avatarType === "group"
  return (
    <div className="mx-auto mt-24 flex max-w-sm flex-col items-center gap-5">
      <EntityAvatar
        targetId={targetId}
        type={entity.avatarType}
        id={entity.avatarId}
        theme={theme}
        size={80}
        label={entity.name}
      />
      <h2 className="text-lg font-medium">{entity.name}</h2>
      <div className="w-full rounded-lg border border-xgui-background-1 p-4 text-sm">
        {isUser ? (
          <>
            <Detail label="昵称" value={(entity as DesktopContactUser).nickname || "未设置"} />
            <Detail label="邮箱" value={(entity as DesktopContactUser).email || "未设置"} />
            <Detail label="电话" value={(entity as DesktopContactUser).phone || "未设置"} />
            <Detail label="状态" value={(entity as DesktopContactUser).online ? "在线" : "离线"} />
          </>
        ) : isGroup ? (
          <>
            <Detail label="成员" value={`${(entity as DesktopContactGroup).memberCount} 人`} />
            <Detail
              label="状态"
              value={(entity as DesktopContactGroup).joined ? "已加入" : "未加入"}
            />
            <Detail
              label="可见性"
              value={(entity as DesktopContactGroup).visibility === "public" ? "公开" : "私有"}
            />
          </>
        ) : (
          <>
            <Detail label="描述" value={(entity as DesktopContactApp).description || "未设置"} />
            <Detail label="状态" value={(entity as DesktopContactApp).online ? "在线" : "离线"} />
          </>
        )}
      </div>
      {(!isUser || entity.id !== userId) && (
        <Button className="w-full" disabled={busy} onClick={onMessage}>
          {busy
            ? "处理中…"
            : isGroup && !(entity as DesktopContactGroup).joined
              ? "加入群聊"
              : "发消息"}
        </Button>
      )}
      {onDeleteFriend && (
        <Button className="w-full" variant="destructive" onClick={onDeleteFriend}>
          删除好友
        </Button>
      )}
      {onManageApp && (
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => onManageApp("edit")}>
            修改资料
          </Button>
          <Button variant="secondary" onClick={() => onManageApp("credentials")}>
            开发指南
          </Button>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 py-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}

function entrySummary(entry: DesktopContactUser | DesktopContactApp | DesktopContactGroup) {
  if (entry.avatarType === "user")
    return entry.nickname || entry.email || (entry.online ? "在线" : "离线")
  if (entry.avatarType === "app") return entry.description || (entry.online ? "在线" : "离线")
  return `${entry.memberCount} 人 · ${entry.joined ? "已加入" : "公开群组"}`
}

function matchesContact(
  entry: DesktopContactUser | DesktopContactApp | DesktopContactGroup,
  query: string,
) {
  if (!query) return true
  const fields =
    entry.avatarType === "user"
      ? [entry.name, entry.nickname, entry.email, entry.phone]
      : entry.avatarType === "app"
        ? [entry.name, entry.description]
        : [entry.name]
  return fields.some((value) => value.toLowerCase().includes(query))
}

function entityFor(directory: DesktopContactDirectory, selection: Selection) {
  return selection.type === "user"
    ? (directory.users.find((item) => item.id === selection.id) ?? null)
    : selection.type === "app"
      ? (directory.apps.find((item) => item.id === selection.id) ?? null)
      : (directory.groups.find((item) => item.id === selection.id) ?? null)
}
