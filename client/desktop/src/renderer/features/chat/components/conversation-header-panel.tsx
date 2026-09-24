import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Loader2, Search } from "lucide-react"
import { DocumentAttachmentIcon } from "@hugeicons/core-free-icons"
import type {
  DesktopContactDirectory,
  DesktopConversation,
  DesktopConversationInfo,
  DesktopLocalAttachment,
  DesktopLocalPage,
} from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Avatar } from "@/components/ui/avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { formatFileSize } from "../message-bodies/utils"

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

function inviteKey(type: InviteCandidate["type"], id: string) {
  return `${type}:${id.toLowerCase()}`
}

function InviteMembers(props: PanelProps) {
  const { conversation, targetId, currentUserId, theme, onClose } = props
  const { showToast } = useAnimatedToast()
  const { info, error: infoError } = useInfo(targetId, conversation.id)
  const [directory, setDirectory] = useState<DesktopContactDirectory | null>(null)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
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
      const leftExisting = left.type === "user" && existing.has(inviteKey(left.type, left.id))
      const rightExisting = right.type === "user" && existing.has(inviteKey(right.type, right.id))
      return Number(rightExisting) - Number(leftExisting)
    })
  }, [canInviteApps, currentUserId, directory, existing, info])
  const visible = candidates.filter((candidate) =>
    candidate.searchText.includes(query.trim().toLocaleLowerCase()),
  )
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
          className="pl-8"
          aria-label="搜索成员或应用"
          type="search"
          placeholder="搜索成员或应用"
          value={query}
          disabled={loading || saving || Boolean(error || infoError)}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ScrollArea
        className="-mt-2 h-64 min-h-32 rounded-md border"
        viewportClassName="[&>div]:block! [&>div]:w-full!"
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
          <ItemGroup className="gap-1! p-2" aria-label="群聊成员和应用">
            {visible.map((candidate) => {
              const key = inviteKey(candidate.type, candidate.id)
              const alreadyMember = existing.has(key)
              const checked = alreadyMember || selected.has(key)
              const checkboxId = `invite-group-${key}`
              return (
                <Item
                  asChild
                  size="sm"
                  className="cursor-pointer px-2 py-1 hover:bg-muted data-[selected=true]:bg-xgui-background-0 data-[selected=true]:hover:bg-xgui-background-0 data-[locked=true]:cursor-default"
                  data-selected={checked}
                  data-locked={alreadyMember}
                  key={key}
                >
                  <Label htmlFor={checkboxId} role="listitem">
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

function ConversationInfo({
  conversation,
  targetId,
  currentUserId,
  theme,
  onClose,
  onConversationRemoved,
}: PanelProps) {
  const { info, error, reload } = useInfo(targetId, conversation.id)
  const { showToast } = useAnimatedToast()
  const [name, setName] = useState(conversation.name)
  const [announcement, setAnnouncement] = useState("")
  const [saving, setSaving] = useState(false)
  const role = info?.members.find(
    (member) => member.type === "user" && member.id.toLowerCase() === currentUserId.toLowerCase(),
  )?.role
  const canManage = role === "owner" || role === "admin"
  const showMembers =
    conversation.type === "group" ||
    (conversation.type === "topic" && conversation.topic?.parentConversationType === "group")
  async function manage(
    input: Parameters<NonNullable<typeof window.desktop>["accountData"]["manageGroup"]>[0],
  ) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.desktop!.accountData.manageGroup(input)
      if (!result.ok) throw new Error(result.error.message)
      showToast({ status: "success", title: "群聊信息已更新" })
      if (input.action === "leave" || input.action === "dissolve") {
        onClose()
        onConversationRemoved()
      } else reload()
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : "群聊操作失败",
      })
    } finally {
      setSaving(false)
    }
  }
  const base = { targetId, conversationId: conversation.id }
  return (
    <div className="min-h-40 space-y-4 overflow-y-auto text-sm">
      <div className="flex items-center gap-3 py-3">
        <EntityAvatar
          targetId={targetId}
          type={conversation.avatarType}
          id={conversation.avatarId}
          theme={theme}
          size={44}
          label={conversation.name}
        />
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
        <div className="space-y-4 border-t pt-4">
          {conversation.type === "group" && (
            <>
              <div>
                <p className="font-medium">群公告</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {info.announcement || "暂无群公告"}
                </p>
              </div>
              <div>
                <p className="font-medium">群类型</p>
                <p className="mt-1 text-muted-foreground">
                  {info.visibility === "public" ? "公开群" : "私密群"}
                </p>
              </div>
            </>
          )}
          {showMembers && (
            <div>
              <p className="font-medium">成员（{info.members.length}）</p>
              <ItemGroup
                className="mt-2 max-h-60 gap-1! overflow-y-auto rounded-md border p-2"
                aria-label="会话成员"
              >
                {info.members.length === 0 && (
                  <p className="px-2 py-4 text-center text-muted-foreground">暂无成员</p>
                )}
                {info.members.map((member) => {
                  const isSelf =
                    member.type === "user" &&
                    member.id.toLowerCase() === currentUserId.toLowerCase()
                  return (
                    <Item
                      key={`${member.type}:${member.id}`}
                      role="listitem"
                      size="sm"
                      className="gap-2 px-2 py-1"
                    >
                      <EntityAvatar
                        targetId={targetId}
                        type={member.type}
                        id={member.id}
                        theme={theme}
                        size={24}
                        label={member.name}
                      />
                      <ItemContent className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{member.name}</span>
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
                        member.role !== "owner" &&
                        (role === "owner" || member.role !== "admin") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            disabled={saving}
                            onClick={() => {
                              if (window.confirm(`确定移出 ${member.name} 吗？`))
                                void manage({
                                  ...base,
                                  action: "remove-member",
                                  memberId: member.id,
                                  memberType: member.type,
                                })
                            }}
                          >
                            移出
                          </Button>
                        )}
                    </Item>
                  )
                })}
              </ItemGroup>
            </div>
          )}
          {conversation.type === "group" && role && (
            <div className="space-y-3 border-t pt-4">
              <p className="font-medium">群聊管理</p>
              <div className="flex gap-2">
                <Input
                  aria-label="群名称"
                  maxLength={50}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={saving}
                />
                <Button
                  variant="outline"
                  disabled={saving || !name.trim() || name.trim() === conversation.name}
                  onClick={() => void manage({ ...base, action: "name", value: name })}
                >
                  保存名称
                </Button>
              </div>
              {canManage && (
                <>
                  <div className="flex gap-2">
                    <textarea
                      aria-label="群公告"
                      maxLength={200}
                      className="min-h-20 min-w-0 flex-1 rounded-md border bg-background p-2"
                      disabled={saving}
                      value={announcement}
                      placeholder={info.announcement || "输入群公告"}
                      onChange={(event) => setAnnouncement(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={saving || announcement.trim() === info.announcement}
                      onClick={() =>
                        void manage({ ...base, action: "announcement", value: announcement })
                      }
                    >
                      保存公告
                    </Button>
                  </div>
                  {role === "owner" && (
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        void manage({
                          ...base,
                          action: info.visibility === "public" ? "private" : "public",
                        })
                      }
                    >
                      {info.visibility === "public" ? "设为私密群" : "设为公开群"}
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => {
                  const action = role === "owner" ? "dissolve" : "leave"
                  if (window.confirm(role === "owner" ? "确定解散群聊吗？" : "确定退出群聊吗？"))
                    void manage({ ...base, action })
                }}
              >
                {role === "owner" ? "解散群聊" : "退出群聊"}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            创建于 {new Date(conversation.createdAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  )
}
