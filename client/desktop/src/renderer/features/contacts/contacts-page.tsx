import { useEffect, useId, useMemo, useState } from "react"
import { ArrowRight01Icon, FlashIcon } from "@hugeicons/core-free-icons"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { SidebarSearchHeader } from "@/components/sidebar-search-header"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import { Badge } from "@/components/ui/badge"
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
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type {
  DesktopClientAppCredentials,
  DesktopContactApp,
  DesktopContactDirectory,
  DesktopContactGroup,
  DesktopContactUser,
  LocalSearchResult,
} from "../../../shared/account-data"
import { ClientAppDialog } from "./client-app-dialog"

type Tab = "user" | "app" | "group"
type Selection = { type: Tab; id: string }

export function ContactsPage({
  targetId,
  serverUrl,
  userId,
  organizationName,
  resolvedTheme,
  onOpenConversation,
  onCreateGroup,
  onCreateApp,
  onRefresh,
  onSelectSearchResult,
  mentionLabelResolver,
}: {
  targetId: string
  serverUrl: string
  userId: string
  organizationName: string
  resolvedTheme: "light" | "dark"
  onOpenConversation: (conversationId: string) => void
  onCreateGroup: () => void
  onCreateApp: () => void
  onRefresh: () => void
  onSelectSearchResult: (result: LocalSearchResult) => void
  mentionLabelResolver: MentionLabelResolver
}) {
  const { showToast } = useAnimatedToast()
  const [directory, setDirectory] = useState<DesktopContactDirectory | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection | null>(null)
  const [busyKey, setBusyKey] = useState("")
  const [appDialog, setAppDialog] = useState<"edit" | "credentials" | null>(null)
  const [credentials, setCredentials] = useState<DesktopClientAppCredentials | null>(null)
  const [avatarRevision, setAvatarRevision] = useState(0)

  async function load(refresh = false, background = false) {
    if (!window.desktop) return
    if (!refresh && !background) setLoading(true)
    const result = refresh
      ? await window.desktop.accountData.refreshContacts(targetId)
      : await window.desktop.accountData.getContacts(targetId)
    if (result.ok) {
      setDirectory(result.data)
      setSelection((current) => (current && entityFor(result.data, current) ? current : null))
    } else showToast({ title: result.error.message, status: "error" })
    if (!background) setLoading(false)
  }

  useEffect(() => {
    void load()
    return window.desktop?.accountData.onChanged((event) => {
      if (event.targetId === targetId && event.domains.includes("contacts")) {
        void load(false, true)
      }
    })
  }, [targetId])

  const sections = useMemo(() => {
    if (!directory) return []
    const users = [...directory.users].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    )
    const apps = [...directory.apps].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    )
    const groups = [...directory.groups].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    )
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
        entries: groups.filter((item) => item.visibility === "public"),
      },
    ]
  }, [directory, organizationName, userId])

  const active = directory && selection ? entityFor(directory, selection) : null
  const isOwnedApp =
    selection?.type === "app" &&
    (active as DesktopContactApp | null)?.creatorUserId?.toLowerCase() === userId.toLowerCase()

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
        <SidebarSearchHeader
          searchLabel="搜索通讯录"
          targetId={targetId}
          theme={resolvedTheme}
          mentionLabelResolver={mentionLabelResolver}
          onSelectSearchResult={onSelectSearchResult}
          onCreateGroup={onCreateGroup}
          onCreateApp={onCreateApp}
          onRefresh={onRefresh}
        />
        <ScrollArea
          type="hover"
          scrollHideDelay={200}
          className="min-h-0 min-w-0 flex-1 overflow-hidden bg-xgui-background-1"
          viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
        >
          <nav className="flex min-h-full flex-col" aria-label="通讯录列表">
            {loading ? (
              <p className="p-4 text-center text-sm text-muted-foreground">正在加载通讯录…</p>
            ) : sections.every((section) => section.entries.length === 0) ? (
              <p className="p-4 text-center text-sm text-muted-foreground">暂无通讯录内容</p>
            ) : (
              <div className="flex flex-col gap-1 bg-xgui-background-0 py-1">
                {sections.map((section) => {
                  if (section.entries.length === 0) return null
                  const expanded = expandedSections.has(section.key)
                  return (
                    <section
                      key={section.key}
                      aria-label={section.label}
                      className="flex flex-col gap-1"
                    >
                      <div className="px-2">
                        <button
                          type="button"
                          className="flex h-10 w-full items-center gap-1 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-foreground/5"
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
                          <Badge variant="secondary" className="text-muted-foreground">
                            {section.entries.length}
                          </Badge>
                        </button>
                      </div>
                      {expanded && (
                        <ItemGroup className="bg-xgui-background-1 px-2 py-1 has-data-[size=sm]:gap-1">
                          {section.entries.map((entry) => {
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
                                    key={`${entry.id}:${avatarRevision}`}
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
                                  {"online" in entry && (
                                    <span
                                      className={cn(
                                        "size-2 shrink-0 rounded-full",
                                        entry.online ? "bg-xgui-green" : "bg-xgui-foreground-4",
                                      )}
                                      aria-label={entry.online ? "在线" : "离线"}
                                    />
                                  )}
                                </button>
                              </Item>
                            )
                          })}
                        </ItemGroup>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </nav>
        </ScrollArea>
      </aside>

      <div className="min-w-0 overflow-y-auto bg-card px-6">
        {active ? (
          <ContactDetails
            key={`${targetId}:${selection!.type}:${active.id}:${avatarRevision}`}
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
              isOwnedApp
                ? (mode) => void openOwnedApp(active as DesktopContactApp, mode)
                : undefined
            }
            onDeleteApp={
              isOwnedApp
                ? async () => {
                    const result = await window.desktop!.accountData.deleteClientApp({
                      targetId,
                      id: active.id,
                    })
                    if (!result.ok) {
                      showToast({ title: result.error.message, status: "error" })
                      return false
                    }
                    setSelection(null)
                    void load(true)
                    showToast({ title: "应用已删除", status: "success" })
                    return true
                  }
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

      {appDialog && (
        <ClientAppDialog
          key={`${targetId}:${appDialog}:${credentials?.app.id ?? ""}`}
          mode={appDialog}
          targetId={targetId}
          serverUrl={serverUrl}
          currentUserId={userId}
          theme={resolvedTheme}
          users={directory?.users ?? []}
          credentials={credentials}
          onClose={() => {
            setAppDialog(null)
            setCredentials(null)
          }}
          onChanged={() => void load(true)}
          onAvatarChanged={() => setAvatarRevision((current) => current + 1)}
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
  onDeleteApp,
  onDeleteFriend,
}: {
  entity: DesktopContactUser | DesktopContactApp | DesktopContactGroup
  targetId: string
  userId: string
  theme: "light" | "dark"
  busy: boolean
  onMessage: () => void
  onManageApp?: (mode: "edit" | "credentials") => void
  onDeleteApp?: () => Promise<boolean>
  onDeleteFriend?: () => void
}) {
  const { showToast } = useAnimatedToast()
  const deleteConfirmationId = useId()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deleting, setDeleting] = useState(false)
  const isUser = entity.avatarType === "user"
  const isGroup = entity.avatarType === "group"

  async function confirmDeleteApp() {
    if (!onDeleteApp || deleting || deleteConfirmation !== entity.name) return
    setDeleting(true)
    try {
      if (await onDeleteApp()) setDeleteOpen(false)
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "删除应用失败",
        status: "error",
      })
    } finally {
      setDeleting(false)
    }
  }
  return (
    <div className="mx-auto mt-24 flex max-w-xs flex-col items-center gap-5">
      <EntityAvatar
        targetId={targetId}
        type={entity.avatarType}
        id={entity.avatarId}
        theme={theme}
        size={80}
        label={entity.name}
      />
      <h2 className="text-lg font-medium">{entity.name}</h2>
      <div className="w-full divide-y divide-border rounded-lg border border-border px-4 py-2 text-sm">
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
      {(!isUser || entity.id !== userId || onDeleteFriend || onManageApp || onDeleteApp) && (
        <div className="grid w-full gap-2">
          {(!isUser || entity.id !== userId) && (
            <BeButton
              className="w-full bg-xgui-brand text-background hover:bg-xgui-brand-4 hover:text-background active:bg-xgui-brand-5"
              disabled={busy}
              onClick={onMessage}
            >
              {busy
                ? "处理中…"
                : isGroup && !(entity as DesktopContactGroup).joined
                  ? "加入群聊"
                  : "发消息"}
            </BeButton>
          )}
          {onDeleteFriend && (
            <BeButton variant="destructive" onClick={onDeleteFriend}>
              删除好友
            </BeButton>
          )}
          {onManageApp && (
            <>
              <BeButton variant="secondary" onClick={() => onManageApp("edit")}>
                修改资料
              </BeButton>
              <BeButton variant="secondary" onClick={() => onManageApp("credentials")}>
                开发指南
              </BeButton>
            </>
          )}
          {onDeleteApp && (
            <BeButton variant="destructive" disabled={deleting} onClick={() => setDeleteOpen(true)}>
              删除应用
            </BeButton>
          )}
        </div>
      )}
      {onDeleteApp && (
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deleting) return
            setDeleteOpen(open)
            if (!open) setDeleteConfirmation("")
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除应用</AlertDialogTitle>
              <AlertDialogDescription>
                删除后应用将无法继续使用，并会退出所有会话；由应用创建的群聊会转交给可用成员，没有可用成员时将被解散。此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={deleteConfirmationId}>
                {`请输入应用名称“${entity.name}”以确认删除`}
              </Label>
              <Input
                id={deleteConfirmationId}
                autoFocus
                disabled={deleting}
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleting || deleteConfirmation !== entity.name}
                onClick={(event) => {
                  event.preventDefault()
                  void confirmDeleteApp()
                }}
              >
                {deleting ? "删除中…" : "删除应用"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 py-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 break-words text-right">{value}</span>
    </div>
  )
}

function entrySummary(entry: DesktopContactUser | DesktopContactApp | DesktopContactGroup) {
  if (entry.avatarType === "user")
    return entry.nickname || entry.email || (entry.online ? "在线" : "离线")
  if (entry.avatarType === "app") return entry.description || (entry.online ? "在线" : "离线")
  return `${entry.memberCount} 人 · ${entry.joined ? "已加入" : "公开群组"}`
}

function entityFor(directory: DesktopContactDirectory, selection: Selection) {
  return selection.type === "user"
    ? (directory.users.find((item) => item.id === selection.id) ?? null)
    : selection.type === "app"
      ? (directory.apps.find((item) => item.id === selection.id) ?? null)
      : (directory.groups.find((item) => item.id === selection.id) ?? null)
}
