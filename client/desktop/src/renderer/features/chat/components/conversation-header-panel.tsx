import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
import { Camera, Ellipsis, Loader2, Search, X } from "lucide-react"
import { DocumentAttachmentIcon } from "@hugeicons/core-free-icons"
import type {
  DesktopContactDirectory,
  DesktopConversation,
  DesktopConversationInfo,
  DesktopLocalAttachment,
  DesktopLocalPage,
  DesktopProjectSummary,
} from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Avatar } from "@/components/ui/avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Switch } from "@/components/motion/switch"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { canPinConversation } from "../conversation-action-policy"
import { formatFileSize } from "../message-bodies/utils"
import { CANDIDATE_ROW_HEIGHT, useVirtualCandidateRows } from "../virtual-candidate-rows"
import { GroupAvatarPicker } from "./group-avatar-picker"

export type HeaderPanel = "topics" | "attachments" | "invite" | "info"

type PanelProps = {
  panel: HeaderPanel
  conversation: DesktopConversation
  targetId: string
  currentUserId: string
  theme: "light" | "dark"
  onClose: () => void
  onLocateMessage: (messageId: string) => Promise<boolean>
  onConversationRemoved: () => void
  onSetPinned: (conversationId: string, pinned: boolean) => Promise<void>
  onSetMuted: (conversationId: string, muted: boolean) => Promise<void>
  onDismiss: (conversationId: string) => Promise<void>
}

export function ConversationHeaderPanel(props: PanelProps) {
  const title = {
    topics: "历史话题",
    attachments: "历史附件",
    invite: "添加成员",
    info: "会话信息",
  }[props.panel]
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {props.conversation.name}的{title}
          </DialogDescription>
        </DialogHeader>
        {props.panel === "topics" ? (
          <LocalTopics {...props} />
        ) : props.panel === "attachments" ? (
          <LocalAttachments {...props} />
        ) : props.panel === "invite" ? (
          <InviteMembers {...props} />
        ) : (
          <ConversationInfo {...props} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function useLocalPage<T>(
  conversationId: string,
  targetId: string,
  list: (input: {
    targetId: string
    conversationId: string
    offset?: number
    keyword?: string
  }) => Promise<
    { ok: true; data: DesktopLocalPage<T> } | { ok: false; error: { message: string } }
  >,
  keyword = "",
) {
  const requestEpoch = useRef(0)
  const currentKeyword = useRef(keyword)
  currentKeyword.current = keyword
  const [items, setItems] = useState<T[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    const epoch = ++requestEpoch.current
    setItems([])
    setNextOffset(null)
    setLoading(true)
    setError("")
    void list({ targetId, conversationId, keyword })
      .then((result) => {
        if (cancelled || epoch !== requestEpoch.current) return
        if (!result.ok) throw new Error(result.error.message)
        setItems(result.data.items)
        setNextOffset(result.data.nextOffset)
      })
      .catch((reason: unknown) => {
        if (!cancelled && epoch === requestEpoch.current) {
          setError(reason instanceof Error ? reason.message : "读取本地记录失败")
        }
      })
      .finally(() => {
        if (!cancelled && epoch === requestEpoch.current) setLoading(false)
      })
    return () => {
      cancelled = true
      requestEpoch.current++
    }
  }, [conversationId, targetId, list, keyword, attempt])
  async function loadMore() {
    if (nextOffset === null || loading) return
    const epoch = requestEpoch.current
    setLoading(true)
    setError("")
    try {
      const result = await list({ targetId, conversationId, offset: nextOffset, keyword })
      if (epoch !== requestEpoch.current || keyword !== currentKeyword.current) return
      if (!result.ok) throw new Error(result.error.message)
      setItems((current) => [...current, ...result.data.items])
      setNextOffset(result.data.nextOffset)
    } catch (reason) {
      if (epoch === requestEpoch.current && keyword === currentKeyword.current) {
        setError(reason instanceof Error ? reason.message : "读取本地记录失败")
      }
    } finally {
      if (epoch === requestEpoch.current && keyword === currentKeyword.current) setLoading(false)
    }
  }
  return {
    items,
    nextOffset,
    loading,
    error,
    loadMore,
    retry: () => setAttempt((value) => value + 1),
  }
}

const listTopics = (input: {
  targetId: string
  conversationId: string
  offset?: number
  keyword?: string
}) => window.desktop!.accountData.listLocalTopics(input)
const listAttachments = (input: {
  targetId: string
  conversationId: string
  offset?: number
  keyword?: string
}) => window.desktop!.accountData.listLocalAttachments(input)

function LocalTopics({ conversation, targetId, theme, onClose, onLocateMessage }: PanelProps) {
  const { showToast } = useAnimatedToast()
  const [keyword, setKeyword] = useState("")
  const [locatingId, setLocatingId] = useState<string | null>(null)
  const page = useLocalPage(conversation.id, targetId, listTopics, keyword)
  async function locate(messageId: string) {
    setLocatingId(messageId)
    try {
      if (await onLocateMessage(messageId)) onClose()
    } finally {
      setLocatingId(null)
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <Input
        type="search"
        aria-label="搜索话题标题"
        placeholder="搜索话题标题"
        maxLength={128}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <PagedList
        page={page}
        empty={keyword.trim() ? "没有匹配的本地话题" : "暂无本地历史话题"}
        hasSearch
      >
        {page.items.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted disabled:opacity-50"
            disabled={Boolean(locatingId)}
            onClick={() => {
              const messageId = topic.topic?.sourceMessageId
              if (messageId) void locate(messageId)
              else showToast({ status: "error", title: "本地没有话题原消息" })
            }}
          >
            <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden>
              <Avatar size="default" className="rounded-sm after:hidden">
                <EntityAvatar
                  targetId={targetId}
                  type={topic.avatarType}
                  id={topic.avatarId}
                  theme={theme}
                  size={32}
                  cacheOnly
                />
                {topic.topic?.sourceSender && (
                  <span className="absolute -right-1 -bottom-1 flex rounded-full bg-background p-0.5 leading-none shadow-xs">
                    <EntityAvatar
                      targetId={targetId}
                      type={topic.topic.sourceSender.type}
                      id={topic.topic.sourceSender.id}
                      theme={theme}
                      size={16}
                      className="rounded-full"
                      cacheOnly
                    />
                  </span>
                )}
              </Avatar>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{topic.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {topic.lastMessageSummary || "暂无回复"}
              </span>
            </span>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={topic.createdAt}>
              {new Date(topic.createdAt).toLocaleDateString()}
            </time>
          </button>
        ))}
      </PagedList>
    </div>
  )
}

function LocalAttachments({ conversation, targetId, onClose, onLocateMessage }: PanelProps) {
  const [keyword, setKeyword] = useState("")
  const [locatingId, setLocatingId] = useState<string | null>(null)
  const page = useLocalPage(conversation.id, targetId, listAttachments, keyword)
  async function locate(messageId: string) {
    if (locatingId) return
    setLocatingId(messageId)
    try {
      if (await onLocateMessage(messageId)) onClose()
    } finally {
      setLocatingId(null)
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <Input
        type="search"
        aria-label="搜索文件名"
        placeholder="搜索文件名"
        maxLength={128}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <PagedList
        page={page}
        empty={keyword.trim() ? "没有匹配的本地附件" : "暂无本地历史附件"}
        hasSearch
      >
        {page.items.map((attachment: DesktopLocalAttachment) => (
          <button
            key={attachment.id}
            type="button"
            className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-md px-2 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            disabled={Boolean(locatingId)}
            onClick={() => void locate(attachment.id)}
          >
            <HugeiconsIcon
              icon={DocumentAttachmentIcon}
              className="size-7 shrink-0"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block w-full truncate">{attachment.body.name}</span>
              <span className="block text-xs text-muted-foreground">
                {formatFileSize(attachment.body.sizeBytes)}
              </span>
            </span>
            <time
              className="shrink-0 text-xs text-muted-foreground"
              dateTime={attachment.createdAt}
            >
              {new Date(attachment.createdAt).toLocaleDateString()}
            </time>
          </button>
        ))}
      </PagedList>
    </div>
  )
}

function PagedList<T>({
  page,
  empty,
  children,
  hasSearch = false,
}: {
  page: ReturnType<typeof useLocalPage<T>>
  empty: string
  children: React.ReactNode
  hasSearch?: boolean
}) {
  return (
    <>
      {/* ScrollArea 的视口使用百分比高度，仅设置 max-height 不会形成滚动容器。 */}
      <ScrollArea
        className={
          hasSearch
            ? "-ml-1 -mr-6 min-w-0 max-h-[calc(80vh-16rem)]"
            : "-mr-5 min-w-0 max-h-[calc(80vh-12rem)]"
        }
        style={{ height: Math.max(160, Math.min(448, page.items.length * 56)) }}
        viewportClassName="overflow-x-hidden pr-5 [&>div]:block! [&>div]:w-full! [&>div]:min-w-0!"
      >
        {page.items.length ? (
          children
        ) : (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            {page.loading ? "正在读取本地记录" : page.error || empty}
          </div>
        )}
      </ScrollArea>
      {page.error && page.items.length > 0 && (
        <p className="text-sm text-destructive">{page.error}</p>
      )}
      {page.error && page.items.length === 0 && (
        <Button variant="outline" onClick={page.retry}>
          重试
        </Button>
      )}
      {page.nextOffset !== null && (
        <Button variant="outline" disabled={page.loading} onClick={() => void page.loadMore()}>
          {page.loading ? "加载中" : "加载更多"}
        </Button>
      )}
    </>
  )
}

function useInfo(targetId: string, conversationId: string) {
  const [info, setInfo] = useState<DesktopConversationInfo | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setError("")
    void window
      .desktop!.accountData.getConversationInfo({ targetId, conversationId })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error.message)
        setInfo(result.data)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "读取会话信息失败")
      })
    return () => {
      cancelled = true
    }
  }, [targetId, conversationId, revision])
  return { info, error, reload: () => setRevision((value) => value + 1) }
}

type InviteCandidate = {
  id: string
  type: "user" | "app"
  name: string
  searchText: string
}

const inviteNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })

function memberRoleOrder(role: string) {
  if (role === "owner") return 0
  if (role === "admin") return 1
  return 2
}

function inviteKey(type: InviteCandidate["type"], id: string) {
  return `${type}:${id.toLowerCase()}`
}

function useMemberNames(targetId: string, info: DesktopConversationInfo | null, enabled: boolean) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map())
  useEffect(() => {
    if (!enabled || !info) return
    let cancelled = false
    void (async () => {
      const directory = await window.desktop!.accountData.getContacts(targetId).catch(() => null)
      const next = new Map<string, string>()
      if (directory?.ok) {
        for (const user of directory.data.users) {
          next.set(inviteKey("user", user.id), user.nickname || user.name)
        }
        for (const app of directory.data.apps) next.set(inviteKey("app", app.id), app.name)
        if (!cancelled) setNames((previous) => new Map([...previous, ...next]))
      }
      const missing = [
        ...new Set(
          info.members
            .filter(
              (member) =>
                member.type === "user" &&
                member.name.toLowerCase() === member.id.toLowerCase() &&
                !next.has(inviteKey("user", member.id)),
            )
            .map((member) => member.id),
        ),
      ]
      for (let offset = 0; offset < missing.length && !cancelled; offset += 100) {
        const result = await window.desktop!.accountData.resolveUserNames({
          targetId,
          userIds: missing.slice(offset, offset + 100),
        })
        if (!result.ok) continue
        for (const user of result.data) next.set(inviteKey("user", user.id), user.name)
        if (!cancelled) setNames((previous) => new Map([...previous, ...next]))
      }
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled, info, targetId])
  return names
}

function InviteMembers(props: PanelProps) {
  const { conversation, targetId, currentUserId, theme, onClose } = props
  const { showToast } = useAnimatedToast()
  const { info, error: infoError } = useInfo(targetId, conversation.id)
  const [directory, setDirectory] = useState<DesktopContactDirectory | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window
      .desktop!.accountData.getContacts(targetId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error.message)
        setDirectory(result.data)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "读取联系人失败")
      })
    return () => {
      cancelled = true
    }
  }, [targetId])
  const role = info?.members.find(
    (member) => member.type === "user" && member.id.toLowerCase() === currentUserId.toLowerCase(),
  )?.role
  const canInviteApps = role === "owner" || role === "admin"
  const existing = useMemo(
    () => new Set(info?.members.map((member) => inviteKey(member.type, member.id))),
    [info],
  )
  const candidates = useMemo(() => {
    if (!directory || !info) return []
    const available = new Map<string, InviteCandidate>()
    for (const user of directory.users) {
      const key = inviteKey("user", user.id)
      if (user.id.toLowerCase() === currentUserId.toLowerCase() && !existing.has(key)) continue
      available.set(key, {
        id: user.id,
        type: "user",
        name: user.nickname || user.name,
        searchText: [user.name, user.nickname, user.email, user.phone]
          .join("\n")
          .toLocaleLowerCase(),
      })
    }
    for (const app of directory.apps) {
      const key = inviteKey("app", app.id)
      if (!canInviteApps && !existing.has(key)) continue
      available.set(key, {
        id: app.id,
        type: "app",
        name: app.name,
        searchText: [app.name, app.description].join("\n").toLocaleLowerCase(),
      })
    }
    for (const member of info.members) {
      const key = inviteKey(member.type, member.id)
      if (!available.has(key)) {
        available.set(key, {
          id: member.id,
          type: member.type,
          name: member.name,
          searchText: member.name.toLocaleLowerCase(),
        })
      }
    }
    return [...available.values()].sort((left, right) => {
      const leftExisting = existing.has(inviteKey(left.type, left.id))
      const rightExisting = existing.has(inviteKey(right.type, right.id))
      return (
        Number(rightExisting) - Number(leftExisting) ||
        inviteNameCollator.compare(left.name, right.name)
      )
    })
  }, [canInviteApps, currentUserId, directory, existing, info])
  const visible = candidates.filter((candidate) =>
    candidate.searchText.includes(query.trim().toLocaleLowerCase()),
  )
  const virtual = useVirtualCandidateRows(visible.length, query)
  const selectedUserCount = [...selected].filter((key) => key.startsWith("user:")).length
  const selectedAppCount = selected.size - selectedUserCount
  const loading = (!directory && !error) || (!info && !infoError)

  function toggle(key: string, checked: boolean | "indeterminate") {
    if (existing.has(key) || saving) return
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(key)
      else next.delete(key)
      return next
    })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || !info || !directory || !selected.size) return
    setSaving(true)
    try {
      const additions = candidates.filter(
        (candidate) =>
          selected.has(inviteKey(candidate.type, candidate.id)) &&
          !existing.has(inviteKey(candidate.type, candidate.id)),
      )
      const result = await window.desktop!.accountData.addGroupMembers({
        targetId,
        conversationId: conversation.id,
        memberIds: additions
          .filter((candidate) => candidate.type === "user")
          .map((user) => user.id),
        appIds: canInviteApps
          ? additions.filter((candidate) => candidate.type === "app").map((app) => app.id)
          : [],
      })
      if (!result.ok) throw new Error(result.error.message)
      showToast({ title: "成员已添加", status: "success" })
      onClose()
    } catch (reason) {
      showToast({
        title: reason instanceof Error ? reason.message : "添加成员失败",
        status: "error",
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="flex min-h-0 flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {(error || infoError) && (
        <p className="text-sm text-destructive" role="alert">
          {error || infoError}
        </p>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          className="pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
          aria-label="搜索成员或应用"
          type="search"
          placeholder="搜索成员或应用"
          value={query}
          disabled={loading || saving || Boolean(error || infoError)}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="清空搜索"
            className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            disabled={loading || saving || Boolean(error || infoError)}
            onClick={() => {
              setQuery("")
              searchInputRef.current?.focus()
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <ScrollArea
        className="-mt-2 h-64 min-h-32 rounded-md border"
        viewportClassName="[&>div]:block! [&>div]:w-full!"
        viewportRef={virtual.viewportRef}
        onViewportScroll={virtual.onViewportScroll}
        aria-busy={loading}
      >
        {loading ? (
          <div className="grid gap-2 p-3" role="status" aria-label="正在加载群聊成员和应用">
            {Array.from({ length: 10 }, (_, index) => (
              <div className="flex items-center gap-3" key={index} aria-hidden="true">
                <Skeleton className="size-6 shrink-0 rounded-sm" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="size-4 shrink-0 rounded-sm" />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <ItemGroup
            className="relative gap-1! p-2"
            style={{ height: virtual.height + 16 }}
            aria-label="群聊成员和应用"
          >
            {visible.slice(virtual.start, virtual.end).map((candidate, offset) => {
              const key = inviteKey(candidate.type, candidate.id)
              const alreadyMember = existing.has(key)
              const checked = alreadyMember || selected.has(key)
              const checkboxId = `invite-group-${key}`
              return (
                <Item
                  asChild
                  size="sm"
                  className="absolute inset-x-2 h-[34px] w-auto! flex-nowrap cursor-pointer px-2 py-1 hover:bg-muted data-[selected=true]:bg-xgui-background-0 data-[selected=true]:hover:bg-xgui-background-0 data-[locked=true]:cursor-default"
                  data-selected={checked}
                  data-locked={alreadyMember}
                  key={key}
                  style={{ top: (virtual.start + offset) * CANDIDATE_ROW_HEIGHT + 8 }}
                >
                  <Label
                    htmlFor={checkboxId}
                    role="listitem"
                    aria-posinset={virtual.start + offset + 1}
                    aria-setsize={visible.length}
                  >
                    <EntityAvatar
                      targetId={targetId}
                      type={candidate.type}
                      id={candidate.id}
                      theme={theme}
                      size={24}
                      label={candidate.name}
                    />
                    <ItemContent className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate">{candidate.name}</span>
                        {candidate.type === "app" && <Badge variant="outline">应用</Badge>}
                      </span>
                    </ItemContent>
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={alreadyMember || saving}
                      aria-label={alreadyMember ? `${candidate.name}，已在群中` : candidate.name}
                      onCheckedChange={(next) => toggle(key, next)}
                    />
                  </Label>
                </Item>
              )
            })}
          </ItemGroup>
        ) : (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            {error || infoError ? "无法读取成员列表" : "没有匹配的成员或应用"}
          </div>
        )}
      </ScrollArea>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        <span className="shrink-0 text-sm text-foreground" aria-live="polite">
          已选择 {selectedUserCount} 人{selectedAppCount > 0 && `、${selectedAppCount} 个应用`}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={!info || !directory || !selected.size || saving}>
            {saving && <Loader2 aria-hidden className="animate-spin" />}
            添加
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}

type ConversationInfoAction =
  | { type: "pin" | "mute" | "public"; value: boolean }
  | { type: "dismiss" | "archive" | "leave" | "dissolve" }
  | { type: "unbind-project"; projectId: string; name: string }
  | { type: "remove-member"; memberId: string; memberType: "user" | "app"; name: string }
  | {
      type: "set-member-role"
      memberId: string
      memberType: "user" | "app"
      name: string
      role: "admin" | "member"
    }

function conversationActionCopy(action: ConversationInfoAction) {
  switch (action.type) {
    case "pin":
      return {
        title: action.value ? "置顶对话？" : "取消置顶？",
        description: action.value
          ? "置顶后，对话将显示在列表顶部。"
          : "取消后，对话将按最近消息排序。",
        label: action.value ? "置顶" : "取消置顶",
        destructive: false,
      }
    case "mute":
      return {
        title: action.value ? "开启消息免打扰？" : "取消消息免打扰？",
        description: action.value ? "开启后，不再提醒此对话的新消息。" : "取消后，恢复新消息提醒。",
        label: action.value ? "开启" : "取消免打扰",
        destructive: false,
      }
    case "public":
      return {
        title: action.value ? "设为公开群？" : "设为私密群？",
        description: action.value
          ? "公开群允许其他用户加入，确定公开此群聊吗？"
          : "设为私密群后，其他用户无法直接加入。",
        label: action.value ? "设为公开群" : "设为私密群",
        destructive: false,
      }
    case "dismiss":
      return {
        title: "删除对话？",
        description:
          "删除后，该对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。",
        label: "删除",
        destructive: true,
      }
    case "archive":
      return {
        title: "关闭话题？",
        description: "关闭后无法继续在话题中发送消息，已有消息仍可查看。",
        label: "关闭话题",
        destructive: true,
      }
    case "leave":
      return {
        title: "退出群聊？",
        description: "退出后，你将不再是该群成员。",
        label: "退出群聊",
        destructive: true,
      }
    case "dissolve":
      return {
        title: "解散群聊？",
        description: "解散后所有成员将无法继续使用此群聊，此操作不可撤销。",
        label: "解散群聊",
        destructive: true,
      }
    case "unbind-project":
      return {
        title: "解除项目关联？",
        description: `确定解除群聊与“${action.name}”的关联吗？解除后，群成员可能失去项目访问权限。`,
        label: "解除关联",
        destructive: true,
      }
    case "remove-member":
      return {
        title: "移出群聊？",
        description: `确定将“${action.name}”移出群聊吗？`,
        label: "移出群聊",
        destructive: true,
      }
    case "set-member-role":
      return {
        title: action.role === "admin" ? "设为管理员？" : "取消管理员？",
        description:
          action.role === "admin"
            ? `确定将“${action.name}”设为管理员吗？管理员可管理群聊成员和项目。`
            : `确定取消“${action.name}”的管理员身份吗？`,
        label: action.role === "admin" ? "设为管理员" : "取消管理员",
        destructive: action.role === "member",
      }
  }
}

function ConversationInfo({
  conversation,
  targetId,
  currentUserId,
  theme,
  onClose,
  onConversationRemoved,
  onSetPinned,
  onSetMuted,
  onDismiss,
}: PanelProps) {
  const { info, error, reload } = useInfo(targetId, conversation.id)
  const { showToast } = useAnimatedToast()
  const [name, setName] = useState(conversation.name)
  const [editingName, setEditingName] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [editingAnnouncement, setEditingAnnouncement] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingField, setSavingField] = useState<"name" | "announcement" | null>(null)
  const [action, setAction] = useState<ConversationInfoAction | null>(null)
  const [savingAction, setSavingAction] = useState(false)
  const [bindDialogOpen, setBindDialogOpen] = useState(false)
  const [availableProjects, setAvailableProjects] = useState<DesktopProjectSummary[] | null>(null)
  const [projectError, setProjectError] = useState("")
  const [projectKeyword, setProjectKeyword] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [bindingProject, setBindingProject] = useState(false)
  const [projectRequest, setProjectRequest] = useState(0)
  const [memberQuery, setMemberQuery] = useState("")
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [avatarCanSave, setAvatarCanSave] = useState(false)
  const avatarFormId = useId()
  const memberSearchInputRef = useRef<HTMLInputElement>(null)
  const role = info?.members.find(
    (member) => member.type === "user" && member.id.toLowerCase() === currentUserId.toLowerCase(),
  )?.role
  const canManage = role === "owner" || role === "admin"
  const showMembers =
    conversation.type === "group" ||
    (conversation.type === "topic" && conversation.topic?.parentConversationType === "group")
  const memberNames = useMemberNames(targetId, info, showMembers)
  const displayMemberName = (member: DesktopConversationInfo["members"][number]) =>
    memberNames.get(inviteKey(member.type, member.id)) ??
    (member.name.toLowerCase() === member.id.toLowerCase()
      ? member.type === "user"
        ? "未知用户"
        : "未知应用"
      : member.name)
  const sortedMembers =
    info?.members
      .slice()
      .sort(
        (left, right) =>
          memberRoleOrder(left.role) - memberRoleOrder(right.role) ||
          inviteNameCollator.compare(displayMemberName(left), displayMemberName(right)) ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      ) ?? []
  const normalizedMemberQuery = memberQuery.trim().toLocaleLowerCase()
  const visibleMembers = normalizedMemberQuery
    ? sortedMembers.filter(
        (member) =>
          displayMemberName(member).toLocaleLowerCase().includes(normalizedMemberQuery) ||
          (member.name.toLowerCase() !== member.id.toLowerCase() &&
            member.name.toLocaleLowerCase().includes(normalizedMemberQuery)),
      )
    : sortedMembers
  const userCount = info?.members.filter((member) => member.type === "user").length ?? 0
  const appCount = (info?.members.length ?? 0) - userCount
  useEffect(() => {
    if (!bindDialogOpen) return
    let cancelled = false
    setAvailableProjects(null)
    setProjectError("")
    void window
      .desktop!.accountData.listBindableProjects(targetId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error.message)
        setAvailableProjects(result.data)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setProjectError(reason instanceof Error ? reason.message : "读取项目失败")
      })
    return () => {
      cancelled = true
    }
  }, [bindDialogOpen, projectRequest, targetId])
  const linkedProjectIds = new Set(info?.projects.map((project) => project.id))
  const matchingProjects = (availableProjects ?? []).filter(
    (project) =>
      !linkedProjectIds.has(project.id) &&
      project.name.toLocaleLowerCase().includes(projectKeyword.trim().toLocaleLowerCase()),
  )
  const selectedProject = matchingProjects.find((project) => project.id === selectedProjectId)
  async function bindProject() {
    if (!canManage || !selectedProject || bindingProject) return
    setBindingProject(true)
    try {
      const result = await window.desktop!.accountData.bindConversationProject({
        targetId,
        conversationId: conversation.id,
        projectId: selectedProject.id,
      })
      if (!result.ok) throw new Error(result.error.message)
      showToast({ status: "success", title: "项目已关联" })
      setBindDialogOpen(false)
      reload()
    } catch (reason) {
      showToast({
        status: "error",
        title: "关联项目失败",
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setBindingProject(false)
    }
  }
  async function manage(
    input: Parameters<NonNullable<typeof window.desktop>["accountData"]["manageGroup"]>[0],
  ) {
    if (saving || savingAction) return
    const fieldLabel =
      input.action === "name" ? "群名称" : input.action === "announcement" ? "群公告" : null
    setSaving(true)
    setSavingField(input.action === "name" || input.action === "announcement" ? input.action : null)
    try {
      const result = await window.desktop!.accountData.manageGroup(input)
      if (!result.ok) throw new Error(result.error.message)
      showToast({
        status: "success",
        title: fieldLabel ? `${fieldLabel}修改成功` : "群聊信息已更新",
      })
      if (input.action === "name") setEditingName(false)
      if (input.action === "announcement") setEditingAnnouncement(false)
      if (input.action === "leave" || input.action === "dissolve") {
        onClose()
        onConversationRemoved()
      } else reload()
    } catch (reason) {
      showToast({
        status: "error",
        title: fieldLabel
          ? `${fieldLabel}修改失败`
          : reason instanceof Error
            ? reason.message
            : "群聊操作失败",
        description: fieldLabel && reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setSaving(false)
      setSavingField(null)
    }
  }
  const base = { targetId, conversationId: conversation.id }
  async function uploadAvatar(bytes: ArrayBuffer) {
    if (conversation.type !== "group" || !canManage || avatarSaving || saving || savingAction)
      return
    setAvatarSaving(true)
    try {
      const result = await window.desktop!.accountData.uploadGroupAvatar({ ...base, bytes })
      if (!result.ok) throw new Error(result.error.message)
      setAvatarPickerOpen(false)
      showToast({ status: "success", title: "群头像已更新" })
      reload()
    } catch (reason) {
      showToast({
        status: "error",
        title: "更换群头像失败",
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setAvatarSaving(false)
    }
  }
  async function confirmAction() {
    if (!action || saving || savingAction) return
    setSavingAction(true)
    try {
      switch (action.type) {
        case "pin":
          await onSetPinned(conversation.id, action.value)
          showToast({ status: "success", title: action.value ? "会话已置顶" : "已取消置顶" })
          break
        case "mute":
          await onSetMuted(conversation.id, action.value)
          showToast({ status: "success", title: action.value ? "已开启免打扰" : "已取消免打扰" })
          break
        case "public": {
          const result = await window.desktop!.accountData.manageGroup({
            ...base,
            action: action.value ? "public" : "private",
          })
          if (!result.ok) throw new Error(result.error.message)
          reload()
          showToast({
            status: "success",
            title: action.value ? "已设为公开群" : "已设为私密群",
          })
          break
        }
        case "dismiss":
          await onDismiss(conversation.id)
          showToast({ status: "success", title: "对话已删除" })
          break
        case "archive": {
          const result = await window.desktop!.accountData.archiveTopic(base)
          if (!result.ok) throw new Error(result.error.message)
          showToast({ status: "success", title: "话题已关闭" })
          break
        }
        case "unbind-project": {
          const result = await window.desktop!.accountData.manageGroup({
            ...base,
            action: "unbind-project",
            projectId: action.projectId,
          })
          if (!result.ok) throw new Error(result.error.message)
          reload()
          showToast({ status: "success", title: "已解除项目关联" })
          break
        }
        case "remove-member": {
          const result = await window.desktop!.accountData.manageGroup({
            ...base,
            action: "remove-member",
            memberId: action.memberId,
            memberType: action.memberType,
          })
          if (!result.ok) throw new Error(result.error.message)
          reload()
          showToast({ status: "success", title: "已移出群聊成员" })
          break
        }
        case "set-member-role": {
          const result = await window.desktop!.accountData.manageGroup({
            ...base,
            action: "set-member-role",
            memberId: action.memberId,
            memberType: action.memberType,
            role: action.role,
          })
          if (!result.ok) throw new Error(result.error.message)
          reload()
          showToast({
            status: "success",
            title: action.role === "admin" ? "已设为管理员" : "已取消管理员",
          })
          break
        }
        case "leave":
        case "dissolve": {
          const result = await window.desktop!.accountData.manageGroup({
            ...base,
            action: action.type,
          })
          if (!result.ok) throw new Error(result.error.message)
          showToast({
            status: "success",
            title: action.type === "leave" ? "已退出群聊" : "群聊已解散",
          })
          break
        }
      }
      setAction(null)
      if (
        action.type === "dismiss" ||
        action.type === "archive" ||
        action.type === "leave" ||
        action.type === "dissolve"
      ) {
        onClose()
        onConversationRemoved()
      }
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : "会话操作失败",
      })
    } finally {
      setSavingAction(false)
    }
  }
  const confirmation = action ? conversationActionCopy(action) : null
  return (
    <>
      <ScrollArea
        type="hover"
        scrollHideDelay={200}
        className="-ml-1 -mr-6 min-h-0 min-w-0"
        viewportClassName="h-auto! max-h-[calc(80vh-12rem)] overflow-x-hidden"
      >
        <div className="space-y-4 pl-1 pr-6 text-sm">
          <div className="flex items-center gap-3 py-3">
            {conversation.type === "group" && canManage ? (
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label="更换群头像"
                title="更换群头像"
                disabled={avatarSaving || saving || savingAction}
                className="group relative shrink-0 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-wait"
                onClick={() => setAvatarPickerOpen(true)}
              >
                <EntityAvatar
                  targetId={targetId}
                  type={conversation.avatarType}
                  id={conversation.avatarId}
                  theme={theme}
                  size={44}
                  label={conversation.name}
                />
                <span
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 text-white transition-opacity ${avatarSaving ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
                >
                  {avatarSaving ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Camera className="size-5" />
                  )}
                </span>
              </button>
            ) : (
              <EntityAvatar
                targetId={targetId}
                type={conversation.avatarType}
                id={conversation.avatarId}
                theme={theme}
                size={44}
                label={conversation.name}
              />
            )}
            <div>
              <div className="font-medium">{conversation.name}</div>
              <div className="text-muted-foreground">
                {conversation.type === "group"
                  ? `群聊 · ${conversation.memberCount} 人`
                  : conversation.type === "direct"
                    ? "私聊"
                    : conversation.type === "topic"
                      ? "话题"
                      : "应用会话"}
              </div>
            </div>
          </div>
          <ItemGroup className="gap-2">
            {canPinConversation(conversation) && (
              <Item variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle>对话置顶</ItemTitle>
                </ItemContent>
                <ItemActions className="shrink-0">
                  <Switch
                    size="sm"
                    checked={conversation.pinned}
                    disabled={saving || savingAction}
                    onCheckedChange={(value) => setAction({ type: "pin", value })}
                    ariaLabel="对话置顶"
                  />
                </ItemActions>
              </Item>
            )}
            <Item variant="outline" size="sm">
              <ItemContent className="min-w-0">
                <ItemTitle>消息免打扰</ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Switch
                  size="sm"
                  checked={conversation.notificationMuted}
                  disabled={saving || savingAction}
                  onCheckedChange={(value) => setAction({ type: "mute", value })}
                  ariaLabel="消息免打扰"
                />
              </ItemActions>
            </Item>
            {conversation.type === "group" && role === "owner" && info && (
              <Item variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle>公开群</ItemTitle>
                </ItemContent>
                <ItemActions className="shrink-0">
                  <Switch
                    size="sm"
                    checked={info.visibility === "public"}
                    disabled={saving || savingAction}
                    onCheckedChange={(value) => setAction({ type: "public", value })}
                    ariaLabel="公开群"
                  />
                </ItemActions>
              </Item>
            )}
          </ItemGroup>
          {error && (
            <>
              <p className="text-destructive">{error}</p>
              <Button variant="outline" onClick={reload}>
                重试
              </Button>
            </>
          )}
          {!info && !error && <p className="text-muted-foreground">正在读取会话信息</p>}
          {info && (
            <div className="space-y-4">
              {conversation.type === "group" && (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">群名称</p>
                      {canManage &&
                        (editingName ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={saving || savingAction}
                              onClick={() => {
                                setName(conversation.name)
                                setEditingName(false)
                              }}
                            >
                              取消
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              disabled={
                                saving ||
                                savingAction ||
                                !name.trim() ||
                                name.trim() === conversation.name
                              }
                              onClick={() => void manage({ ...base, action: "name", value: name })}
                              aria-busy={savingField === "name"}
                            >
                              {savingField === "name" && (
                                <Loader2 aria-hidden className="animate-spin" />
                              )}
                              保存
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={saving || savingAction}
                            onClick={() => {
                              setName(conversation.name)
                              setEditingName(true)
                            }}
                          >
                            修改
                          </Button>
                        ))}
                    </div>
                    <div
                      className={`mt-2 flex min-h-10 items-center rounded-md border px-3 py-2 text-foreground select-text focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 ${editingName ? "bg-transparent" : "bg-muted/50"}`}
                    >
                      {editingName && canManage ? (
                        <input
                          type="text"
                          aria-label="群名称"
                          autoFocus
                          maxLength={50}
                          className="w-full min-w-0 bg-transparent outline-none"
                          disabled={saving || savingAction}
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      ) : (
                        <p className="break-words">{conversation.name}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">群公告</p>
                      {canManage &&
                        (editingAnnouncement ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={saving || savingAction}
                              onClick={() => {
                                setAnnouncement(info.announcement)
                                setEditingAnnouncement(false)
                              }}
                            >
                              取消
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              disabled={
                                saving ||
                                savingAction ||
                                announcement.trim() === info.announcement.trim()
                              }
                              onClick={() =>
                                void manage({
                                  ...base,
                                  action: "announcement",
                                  value: announcement,
                                })
                              }
                              aria-busy={savingField === "announcement"}
                            >
                              {savingField === "announcement" && (
                                <Loader2 aria-hidden className="animate-spin" />
                              )}
                              保存
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={saving || savingAction}
                            onClick={() => {
                              setAnnouncement(info.announcement)
                              setEditingAnnouncement(true)
                            }}
                          >
                            修改
                          </Button>
                        ))}
                    </div>
                    <div
                      className={`mt-2 min-h-20 max-h-60 overflow-y-auto rounded-md border p-3 text-foreground select-text focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 ${editingAnnouncement ? "bg-transparent" : "bg-muted/50"}`}
                    >
                      {editingAnnouncement && canManage ? (
                        <textarea
                          aria-label="群公告"
                          autoFocus
                          maxLength={200}
                          className="block min-h-14 w-full resize-y break-all bg-transparent outline-none placeholder:text-muted-foreground"
                          disabled={saving || savingAction}
                          value={announcement}
                          placeholder="输入群公告"
                          onChange={(event) => setAnnouncement(event.target.value)}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-all">
                          {info.announcement || (
                            <span className="text-muted-foreground">暂无群公告</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">项目</p>
                      {canManage && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={saving || savingAction}
                          onClick={() => {
                            setProjectKeyword("")
                            setSelectedProjectId("")
                            setBindDialogOpen(true)
                          }}
                        >
                          关联
                        </Button>
                      )}
                    </div>
                    <ItemGroup className="mt-2 gap-1! rounded-md border p-2" aria-label="关联项目">
                      {info.projects.length === 0 && (
                        <p className="px-2 py-4 text-center text-muted-foreground">暂无关联项目</p>
                      )}
                      {info.projects.map((project) => (
                        <Item
                          key={project.id}
                          role="listitem"
                          size="sm"
                          className="gap-2 px-2 py-1 hover:bg-muted"
                        >
                          <EntityAvatar
                            targetId={targetId}
                            type="project"
                            id={project.id}
                            theme={theme}
                            size={28}
                            label={project.name}
                          />
                          <ItemContent className="min-w-0">
                            <span className="truncate">{project.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {project.description.trim() || "暂无说明"}
                            </span>
                          </ItemContent>
                          {canManage && (
                            <ItemActions className="shrink-0">
                              <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={`${project.name}更多操作`}
                                    disabled={saving || savingAction || bindingProject}
                                  >
                                    <Ellipsis aria-hidden className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() =>
                                      setAction({
                                        type: "unbind-project",
                                        projectId: project.id,
                                        name: project.name,
                                      })
                                    }
                                  >
                                    解除关联
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </ItemActions>
                          )}
                        </Item>
                      ))}
                    </ItemGroup>
                  </div>
                  {role !== "owner" && (
                    <div>
                      <p className="font-medium">群类型</p>
                      <p className="mt-1 text-muted-foreground">
                        {info.visibility === "public" ? "公开群" : "私密群"}
                      </p>
                    </div>
                  )}
                </>
              )}
              {showMembers && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">成员</p>
                    <p className="text-xs text-muted-foreground">
                      共 {userCount} 人、{appCount} 个应用
                    </p>
                  </div>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={memberSearchInputRef}
                      className="pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
                      type="search"
                      aria-label="搜索群成员或应用"
                      placeholder="搜索群成员或应用"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                    />
                    {memberQuery && (
                      <button
                        type="button"
                        aria-label="清空成员搜索"
                        className="absolute top-1/2 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          setMemberQuery("")
                          memberSearchInputRef.current?.focus()
                        }}
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  <ItemGroup className="mt-2 gap-1! rounded-md border p-2" aria-label="会话成员">
                    {info.members.length === 0 && (
                      <p className="px-2 py-4 text-center text-muted-foreground">暂无成员</p>
                    )}
                    {info.members.length > 0 && visibleMembers.length === 0 && (
                      <p className="px-2 py-4 text-center text-muted-foreground">
                        没有匹配的成员或应用
                      </p>
                    )}
                    {visibleMembers.map((member) => {
                      const memberName = displayMemberName(member)
                      const isSelf =
                        member.type === "user" &&
                        member.id.toLowerCase() === currentUserId.toLowerCase()
                      return (
                        <Item
                          key={`${member.type}:${member.id}`}
                          role="listitem"
                          size="sm"
                          className="gap-2 px-2 py-1 hover:bg-muted"
                        >
                          <EntityAvatar
                            targetId={targetId}
                            type={member.type}
                            id={member.id}
                            theme={theme}
                            size={24}
                            label={memberName}
                          />
                          <ItemContent className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate">{memberName}</span>
                              {member.type === "app" && <Badge variant="outline">应用</Badge>}
                              {conversation.type === "group" && member.role === "owner" && (
                                <Badge variant="outline">群主</Badge>
                              )}
                              {conversation.type === "group" && member.role === "admin" && (
                                <Badge variant="outline">管理员</Badge>
                              )}
                              {isSelf && <Badge variant="outline">我</Badge>}
                            </span>
                          </ItemContent>
                          {conversation.type === "group" &&
                            canManage &&
                            !isSelf &&
                            member.role !== "owner" && (
                              <ItemActions className="shrink-0">
                                <DropdownMenu modal={false}>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="ghost"
                                      aria-label={`${memberName}更多操作`}
                                      disabled={saving || savingAction || bindingProject}
                                    >
                                      <Ellipsis aria-hidden className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        setAction({
                                          type: "set-member-role",
                                          memberId: member.id,
                                          memberType: member.type,
                                          name: memberName,
                                          role: member.role === "admin" ? "member" : "admin",
                                        })
                                      }
                                    >
                                      {member.role === "admin" ? "取消管理员" : "设为管理员"}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() =>
                                        setAction({
                                          type: "remove-member",
                                          memberId: member.id,
                                          memberType: member.type,
                                          name: memberName,
                                        })
                                      }
                                    >
                                      移出群聊
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </ItemActions>
                            )}
                        </Item>
                      )
                    })}
                  </ItemGroup>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
      <Dialog
        open={avatarPickerOpen}
        onOpenChange={(open) => {
          if (!avatarSaving) {
            setAvatarPickerOpen(open)
            if (!open) setAvatarCanSave(false)
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-[26rem]"
        >
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div>
              <DialogTitle>修改群头像</DialogTitle>
              <DialogDescription className="sr-only">
                上传并裁切一张图片作为群聊头像
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭群头像选择"
                disabled={avatarSaving}
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <ScrollArea
            type="hover"
            scrollHideDelay={200}
            className="-mr-2 min-h-0"
            viewportClassName="h-auto! max-h-[calc(80vh-11rem)] overflow-x-hidden"
          >
            <div className="pr-2">
              <GroupAvatarPicker
                formId={avatarFormId}
                saving={avatarSaving}
                onReadyChange={setAvatarCanSave}
                onSave={uploadAvatar}
              />
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 flex-row justify-end">
            <Button type="submit" form={avatarFormId} disabled={!avatarCanSave || avatarSaving}>
              {avatarSaving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DialogFooter className="flex-row shrink-0 flex-wrap justify-end gap-2">
        <Button
          variant="destructive"
          disabled={saving || savingAction}
          onClick={() => setAction({ type: "dismiss" })}
        >
          删除对话
        </Button>
        {conversation.type === "topic" &&
          info?.canArchiveTopic &&
          !conversation.topic?.archived && (
            <Button
              variant="destructive"
              disabled={saving || savingAction}
              onClick={() => setAction({ type: "archive" })}
            >
              关闭话题
            </Button>
          )}
        {conversation.type === "group" && role && role !== "owner" && (
          <Button
            variant="destructive"
            disabled={saving || savingAction}
            onClick={() => setAction({ type: "leave" })}
          >
            退出群聊
          </Button>
        )}
        {conversation.type === "group" && role === "owner" && (
          <Button
            variant="destructive"
            disabled={saving || savingAction}
            onClick={() => setAction({ type: "dissolve" })}
          >
            解散群聊
          </Button>
        )}
      </DialogFooter>
      <AlertDialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !savingAction) setAction(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingAction}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.destructive ? "destructive" : "default"}
              disabled={savingAction}
              aria-busy={savingAction}
              onClick={(event) => {
                event.preventDefault()
                void confirmAction()
              }}
            >
              {savingAction && <Loader2 aria-hidden className="animate-spin" />}
              {confirmation?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={bindDialogOpen}
        onOpenChange={(open) => {
          if (!bindingProject) setBindDialogOpen(open)
        }}
      >
        <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>关联项目</DialogTitle>
            <DialogDescription>选择一个当前可访问的协作项目。</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              type="search"
              aria-label="搜索项目"
              placeholder="搜索项目"
              value={projectKeyword}
              disabled={bindingProject}
              onChange={(event) => setProjectKeyword(event.target.value)}
            />
          </div>
          <ScrollArea
            className="h-64 min-h-0 rounded-md border"
            viewportClassName="[&>div]:block! [&>div]:w-full!"
            aria-busy={availableProjects === null && !projectError}
          >
            {projectError ? (
              <div className="flex flex-col items-center gap-2 px-3 py-8" role="alert">
                <p className="text-sm text-destructive">{projectError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setProjectRequest((value) => value + 1)}
                >
                  重试
                </Button>
              </div>
            ) : availableProjects === null ? (
              <div className="grid gap-2 p-3" role="status" aria-label="正在加载项目">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3" aria-hidden>
                    <Skeleton className="size-7 rounded-sm" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : matchingProjects.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {projectKeyword.trim() ? "没有匹配的项目" : "暂无可关联项目"}
              </p>
            ) : (
              <RadioGroup
                className="gap-1 p-2"
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
                disabled={bindingProject}
              >
                {matchingProjects.map((project) => {
                  const radioId = `bind-project-${project.id}`
                  return (
                    <Item
                      asChild
                      key={project.id}
                      size="sm"
                      className="cursor-pointer gap-2 px-2 py-1.5 hover:bg-muted"
                    >
                      <Label htmlFor={radioId}>
                        <EntityAvatar
                          targetId={targetId}
                          type="project"
                          id={project.id}
                          theme={theme}
                          size={28}
                          label={project.name}
                        />
                        <ItemContent className="min-w-0">
                          <span className="truncate">{project.name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {project.description.trim() || "暂无说明"}
                          </span>
                        </ItemContent>
                        <ItemActions>
                          <RadioGroupItem
                            id={radioId}
                            value={project.id}
                            aria-label={project.name}
                          />
                        </ItemActions>
                      </Label>
                    </Item>
                  )
                })}
              </RadioGroup>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={bindingProject}
              onClick={() => setBindDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!canManage || !selectedProject || bindingProject}
              aria-busy={bindingProject}
              onClick={() => void bindProject()}
            >
              {bindingProject && <Loader2 aria-hidden className="animate-spin" />}
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
