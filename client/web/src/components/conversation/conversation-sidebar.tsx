import * as React from "react"
import { BellOff, Bot, Pin, Plus } from "lucide-react"
import { toast } from "sonner"

import { ConversationListItemMenu } from "@/components/conversation-list-item-menu"
import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GlobalSearchCommand } from "@/components/global-search-command"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatActivityTime } from "@/lib/activity-time"
import type {
  ClientConversation,
  ClientMessage,
  ClientMessageSearchResult,
  ClientUser,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import { getConversationDisplayName } from "@/lib/conversation-avatar-presentation"
import {
  getClientDataErrorMessage,
  isBuiltinAssistantConversation,
  isConversationTopicVisibleInList,
  orderConversations,
  getMessageSummary,
} from "@/lib/client-data-state"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import type { ConversationDrafts } from "@/lib/conversation-drafts"
import type { DirectorySearchItem } from "@/lib/local-search"
import {
  formatMentionTemplateText,
  type MentionLabelResolver,
} from "@/lib/message-mentions"
import { cn } from "@/lib/utils"

const conversationFilterOptions = [
  { label: "全部", value: "all" },
  { label: "未读", value: "unread" },
  { label: "单聊", value: "direct" },
  { label: "群聊", value: "group" },
] as const

type ConversationFilter = (typeof conversationFilterOptions)[number]["value"]

type ConversationListRow = {
  conversation: ClientConversation
  nested: boolean
}

type ConversationSidebarRowProps = {
  appsById: ReadonlyMap<string, ContactApp>
  contactsById: ReadonlyMap<string, ContactUser>
  conversation: ClientConversation
  currentUser: ClientUser
  dismissing: boolean
  draftText?: string
  lastCachedMessage?: ClientMessage
  muting: boolean
  nested: boolean
  onDismiss: (conversation: ClientConversation) => void
  onMutedChange: (conversation: ClientConversation, muted: boolean) => void
  onPinnedChange: (conversation: ClientConversation, pinned: boolean) => void
  onRender?: (conversationId: string) => void
  onSelect: (conversationId: string) => void
  pinning: boolean
  selected: boolean
}

export function ConversationSidebar({
  activeConversationId,
  appsById,
  contactApps = [],
  contactGroups = [],
  contacts = [],
  contactsById,
  conversations,
  currentUser,
  drafts,
  getLatestCachedMessage = () => undefined,
  onCreateGroup,
  onManageFriends,
  onDismissConversation,
  onOpenGlobalSearch,
  onSelectDirectoryItem = noopSelectDirectoryItem,
  onSelectConversation,
  onSelectMessageResult,
  onSetConversationMuted,
  onSetConversationPinned,
  onRowRender,
}: {
  activeConversationId: string
  appsById: ReadonlyMap<string, ContactApp>
  contactApps?: ContactApp[]
  contactGroups?: ContactGroup[]
  contacts?: ContactUser[]
  contactsById: ReadonlyMap<string, ContactUser>
  conversations: ClientConversation[]
  currentUser: ClientUser
  drafts: ConversationDrafts
  getLatestCachedMessage?: (conversationId: string) => ClientMessage | undefined
  onCreateGroup: () => void
  onManageFriends?: () => void
  onDismissConversation?: (conversationId: string) => Promise<void>
  onOpenGlobalSearch?: () => void
  onSelectDirectoryItem?: (item: DirectorySearchItem) => void
  onSelectConversation: (conversationId: string) => void
  onSelectMessageResult?: (result: ClientMessageSearchResult) => void
  onSetConversationMuted?: (
    conversationId: string,
    muted: boolean
  ) => Promise<void>
  onSetConversationPinned: (
    conversationId: string,
    pinned: boolean
  ) => Promise<void>
  onRowRender?: (conversationId: string) => void
}) {
  const [conversationFilter, setConversationFilter] =
    React.useState<ConversationFilter>("all")
  const [pinningConversationId, setPinningConversationId] = React.useState("")
  const [mutingConversationId, setMutingConversationId] = React.useState("")
  const [dismissingConversationId, setDismissingConversationId] =
    React.useState("")
  const [dismissCandidate, setDismissCandidate] =
    React.useState<ClientConversation | null>(null)
  const [listNow, setListNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const interval = window.setInterval(() => setListNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  const visibleRows = React.useMemo(
    () =>
      getConversationListRows({
        activeConversationId,
        conversations,
        filter: conversationFilter,
        now: listNow,
      }),
    [activeConversationId, conversationFilter, conversations, listNow]
  )

  const handlePinnedChange = React.useCallback(
    async (conversation: ClientConversation, pinned: boolean) => {
      if (pinningConversationId) {
        return
      }
      setPinningConversationId(conversation.id)
      try {
        await onSetConversationPinned(conversation.id, pinned)
        toast.success(pinned ? "会话已置顶" : "已取消置顶")
      } catch (error) {
        toast.error(
          getClientDataErrorMessage(
            error,
            pinned ? "置顶会话失败" : "取消置顶失败"
          )
        )
      } finally {
        setPinningConversationId("")
      }
    },
    [onSetConversationPinned, pinningConversationId]
  )

  const handleMutedChange = React.useCallback(
    async (conversation: ClientConversation, muted: boolean) => {
      if (mutingConversationId || !onSetConversationMuted) {
        return
      }
      setMutingConversationId(conversation.id)
      try {
        await onSetConversationMuted(conversation.id, muted)
        toast.success(muted ? "已开启消息免打扰" : "已取消消息免打扰")
      } catch (error) {
        toast.error(
          getClientDataErrorMessage(
            error,
            muted ? "开启消息免打扰失败" : "取消消息免打扰失败"
          )
        )
      } finally {
        setMutingConversationId("")
      }
    },
    [mutingConversationId, onSetConversationMuted]
  )

  async function handleDismissConversation() {
    if (
      !dismissCandidate ||
      dismissingConversationId ||
      !onDismissConversation
    ) {
      return
    }
    const conversation = dismissCandidate
    setDismissingConversationId(conversation.id)
    try {
      await onDismissConversation(conversation.id)
      setDismissCandidate(null)
      toast.success("对话已删除")
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "删除对话失败"))
    } finally {
      setDismissingConversationId("")
    }
  }

  function handleConversationListContextMenu(
    event: React.MouseEvent<HTMLDivElement>
  ) {
    const target = event.target

    if (
      target instanceof Element &&
      target.closest("[data-conversation-list-item-trigger]")
    ) {
      return
    }

    event.preventDefault()
  }

  function getSearchConversationDescription(conversation: ClientConversation) {
    return getConversationListDescription(
      conversation,
      getLatestCachedMessage(conversation.id),
      createConversationMentionLabelResolver({
        appsById,
        contactsById,
        conversation,
        currentUser,
      }),
      currentUser,
      contactsById,
      appsById
    )
  }

  const rowActionsRef = React.useRef({
    dismiss: setDismissCandidate,
    mute: handleMutedChange,
    pin: handlePinnedChange,
    select: onSelectConversation,
  })
  React.useEffect(() => {
    rowActionsRef.current = {
      dismiss: setDismissCandidate,
      mute: handleMutedChange,
      pin: handlePinnedChange,
      select: onSelectConversation,
    }
  }, [handleMutedChange, handlePinnedChange, onSelectConversation])
  const dismissRow = React.useCallback(
    (conversation: ClientConversation) =>
      rowActionsRef.current.dismiss(conversation),
    []
  )
  const muteRow = React.useCallback(
    (conversation: ClientConversation, muted: boolean) =>
      void rowActionsRef.current.mute(conversation, muted),
    []
  )
  const pinRow = React.useCallback(
    (conversation: ClientConversation, pinned: boolean) =>
      void rowActionsRef.current.pin(conversation, pinned),
    []
  )
  const selectRow = React.useCallback(
    (conversationId: string) => rowActionsRef.current.select(conversationId),
    []
  )

  return (
    <Sidebar className="border-r bg-background" collapsible="none">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex h-14 items-center justify-between px-4">
          <h1 className="text-base font-medium">消息</h1>
          <div className="flex items-center gap-1">
            <GlobalSearchCommand
              contactApps={contactApps}
              contactGroups={contactGroups}
              contacts={contacts}
              conversations={conversations}
              currentUserId={currentUser.id}
              getConversationDescription={getSearchConversationDescription}
              onOpen={onOpenGlobalSearch}
              onSelectDirectoryItem={onSelectDirectoryItem}
              onSelectConversation={onSelectConversation}
              onSelectMessageResult={onSelectMessageResult}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="新建 Agent"
                  size="icon-sm"
                  title="新建 Agent"
                  type="button"
                  variant="ghost"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onSelect={onCreateGroup}>
                  发起群聊
                </DropdownMenuItem>
                {onManageFriends && (
                  <DropdownMenuItem onSelect={onManageFriends}>
                    添加好友
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="px-4 pb-3">
          <Tabs
            className="gap-0"
            onValueChange={(value) =>
              setConversationFilter(value as ConversationFilter)
            }
            value={conversationFilter}
          >
            <TabsList aria-label="会话类型" className="grid w-full grid-cols-4">
              {conversationFilterOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </SidebarHeader>
      <SidebarContent onContextMenu={handleConversationListContextMenu}>
        <SidebarMenu className="px-2 pb-3">
          {visibleRows.length === 0 && (
            <SidebarMenuItem>
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {getEmptyConversationFilterMessage(conversationFilter)}
              </div>
            </SidebarMenuItem>
          )}
          {visibleRows.map(({ conversation, nested }) => (
            <ConversationSidebarRow
              appsById={appsById}
              contactsById={contactsById}
              conversation={conversation}
              currentUser={currentUser}
              dismissing={dismissingConversationId === conversation.id}
              draftText={
                conversation.topic?.archived
                  ? undefined
                  : drafts[conversation.id]?.text
              }
              key={conversation.id}
              lastCachedMessage={getLatestCachedMessage(conversation.id)}
              muting={mutingConversationId === conversation.id}
              nested={nested}
              onDismiss={dismissRow}
              onMutedChange={muteRow}
              onPinnedChange={pinRow}
              onRender={onRowRender}
              onSelect={selectRow}
              pinning={pinningConversationId === conversation.id}
              selected={conversation.id === activeConversationId}
            />
          ))}
        </SidebarMenu>
      </SidebarContent>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !dismissingConversationId) {
            setDismissCandidate(null)
          }
        }}
        open={Boolean(dismissCandidate)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，该对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(dismissingConversationId)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(dismissingConversationId)}
              onClick={(event) => {
                event.preventDefault()
                void handleDismissConversation()
              }}
              variant="destructive"
            >
              {dismissingConversationId ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}

function getConversationListRows({
  activeConversationId,
  conversations,
  filter,
  now,
}: {
  activeConversationId: string
  conversations: ClientConversation[]
  filter: ConversationFilter
  now: number
}): ConversationListRow[] {
  const orderedConversations = orderConversations(conversations, now)
  const parentById = new Map(
    orderedConversations
      .filter((conversation) => conversation.type !== "topic")
      .map((conversation) => [conversation.id, conversation])
  )
  const topicsByParentId = new Map<string, ClientConversation[]>()
  for (const conversation of orderedConversations) {
    if (
      conversation.type !== "topic" ||
      !isConversationTopicVisibleInList(conversation, {
        activeConversationId,
        now,
      })
    ) {
      continue
    }
    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parentById.has(parentId)) {
      continue
    }
    const topics = topicsByParentId.get(parentId) ?? []
    topics.push(conversation)
    topicsByParentId.set(parentId, topics)
  }

  const rows: ConversationListRow[] = []
  for (const conversation of orderedConversations) {
    if (conversation.type === "topic") {
      continue
    }
    const topics = topicsByParentId.get(conversation.id) ?? []
    if (filter === "unread") {
      const unreadTopics = topics.filter(hasUnreadMessages)
      if (!hasUnreadMessages(conversation) && unreadTopics.length === 0) {
        continue
      }
      rows.push({ conversation, nested: false })
      rows.push(
        ...unreadTopics.map((topic) => ({ conversation: topic, nested: true }))
      )
      continue
    }
    const matchesFilter =
      filter === "all" ||
      conversation.type === filter ||
      (filter === "direct" && conversation.type === "app")
    if (!matchesFilter) {
      continue
    }
    rows.push({ conversation, nested: false })
    rows.push(...topics.map((topic) => ({ conversation: topic, nested: true })))
  }
  return rows
}

function hasUnreadMessages(conversation: ClientConversation) {
  return (
    conversation.unreadCount > 0 ||
    conversation.lastMessageSeq > conversation.lastReadSeq
  )
}

function noopSelectDirectoryItem() {}

export const ConversationSidebarRow = React.memo(
  function ConversationSidebarRow({
    appsById,
    contactsById,
    conversation,
    currentUser,
    dismissing,
    draftText,
    lastCachedMessage,
    muting,
    nested,
    onDismiss,
    onMutedChange,
    onPinnedChange,
    onRender,
    onSelect,
    pinning,
    selected,
  }: ConversationSidebarRowProps) {
    onRender?.(conversation.id)
    const lastMessageTime = formatActivityTime(
      conversation.lastMessageAt ?? conversation.createdAt
    )
    const preview = getConversationListPreview({
      draftText,
      hasUnreadMention:
        conversation.lastMentionedSeq > conversation.lastReadSeq,
      hasUnreadChoice: conversation.lastChoiceSeq > conversation.lastReadSeq,
      lastChoiceSeq: conversation.lastChoiceSeq,
      lastMentionedSeq: conversation.lastMentionedSeq,
      messageDescription: getConversationListDescription(
        conversation,
        lastCachedMessage,
        createConversationMentionLabelResolver({
          appsById,
          contactsById,
          conversation,
          currentUser,
        }),
        currentUser,
        contactsById,
        appsById
      ),
      selected,
    })
    return (
      <ConversationListItemMenu
        dismissing={dismissing}
        muted={Boolean(conversation.notificationMuted)}
        muting={muting}
        onDismiss={() => onDismiss(conversation)}
        onMutedChange={(muted) => onMutedChange(conversation, muted)}
        onPinnedChange={(pinned) => onPinnedChange(conversation, pinned)}
        pinned={!nested && Boolean(conversation.pinned)}
        pinning={pinning}
        showPinAction={!nested && !isBuiltinAssistantConversation(conversation)}
      >
        <SidebarMenuItem
          className={cn(nested && "ml-4 w-[calc(100%-1rem)]")}
          data-conversation-list-item-trigger
        >
          <SidebarMenuButton
            className={cn(
              "gap-3 data-active:bg-(--weui-brand-1) data-active:hover:bg-(--weui-brand-1)",
              nested ? "h-14 py-1.5" : "h-16 py-2",
              !nested &&
                conversation.pinned &&
                "bg-neutral-100 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-900"
            )}
            isActive={selected}
            onClick={() => onSelect(conversation.id)}
            size="lg"
            type="button"
          >
            <ConversationListAvatar conversation={conversation} />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden text-sm leading-snug font-medium underline-offset-4">
                <span className="flex min-w-0 flex-1 items-center overflow-hidden">
                  <span className="block min-w-0 flex-1 truncate">
                    {nested
                      ? conversation.name
                      : getConversationDisplayName(conversation)}
                  </span>
                  {conversation.topic?.archived && (
                    <span className="ml-1.5 shrink-0 text-[10px] font-normal text-muted-foreground">
                      已关闭
                    </span>
                  )}
                </span>
                {lastMessageTime && (
                  <span className="shrink-0 pr-2 text-xs font-normal text-muted-foreground">
                    {lastMessageTime}
                  </span>
                )}
              </div>
              <p className="flex w-full min-w-0 items-center gap-0.5 text-left text-xs leading-normal font-normal text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {preview.alertLabel && (
                    <span className="mr-1 font-medium text-rose-700 dark:text-rose-300">
                      {preview.alertLabel}
                    </span>
                  )}
                  <span>{preview.description}</span>
                </span>
                {((!nested && conversation.pinned) ||
                  conversation.notificationMuted) && (
                  <span className="mr-2 flex shrink-0 items-center gap-0.5">
                    {!nested && conversation.pinned && (
                      <Pin aria-label="已置顶" className="size-3! shrink-0" />
                    )}
                    {conversation.notificationMuted && (
                      <BellOff
                        aria-label="消息免打扰"
                        className="size-3! shrink-0"
                      />
                    )}
                  </span>
                )}
              </p>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </ConversationListItemMenu>
    )
  }
)

function getEmptyConversationFilterMessage(filter: ConversationFilter) {
  const label = conversationFilterOptions.find(
    (option) => option.value === filter
  )?.label

  return filter === "all" ? "暂无会话" : `暂无${label ?? "会话"}`
}

function getConversationListDescription(
  conversation: ClientConversation,
  message: ClientMessage | undefined,
  mentionLabelResolver: MentionLabelResolver,
  currentUser: ClientUser,
  contactsById: ReadonlyMap<string, ContactUser>,
  appsById: ReadonlyMap<string, ContactApp>
) {
  if (!message) {
    return "暂无消息"
  }

  const description = formatMentionTemplateText(
    getMessageSummary(message),
    mentionLabelResolver
  )
  const showsSender =
    conversation.type === "group" ||
    (conversation.type === "topic" &&
      conversation.topic?.parentConversationType === "group")
  if (!showsSender) {
    return description
  }
  const senderName = getCachedMessageSenderName(
    message,
    currentUser,
    contactsById,
    appsById
  )
  return senderName ? `${senderName}：${description}` : description
}

function getCachedMessageSenderName(
  message: ClientMessage,
  currentUser: ClientUser,
  contactsById: ReadonlyMap<string, ContactUser>,
  appsById: ReadonlyMap<string, ContactApp>
) {
  const sender = message.sender
  if (sender.type === "system") return "系统"
  if (sender.type === "user" && sender.id === currentUser.id) return "我"
  if (sender.type === "user") {
    const user = contactsById.get(sender.id)
    return user?.nickname.trim() || user?.name.trim() || ""
  }
  return appsById.get(sender.id)?.name.trim() || ""
}

function getConversationListPreview({
  draftText,
  hasUnreadMention,
  hasUnreadChoice,
  lastChoiceSeq,
  lastMentionedSeq,
  messageDescription,
  selected,
}: {
  draftText: string | undefined
  hasUnreadMention: boolean
  hasUnreadChoice: boolean
  lastChoiceSeq: number
  lastMentionedSeq: number
  messageDescription: string
  selected: boolean
}) {
  if (selected) {
    return {
      alertLabel: null,
      description: messageDescription,
    }
  }

  if (hasUnreadChoice && lastChoiceSeq >= lastMentionedSeq) {
    return {
      alertLabel: "[选择]",
      description: messageDescription.replace(/(^|：)\[选择\]\s*/, "$1"),
    }
  }

  if (hasUnreadMention) {
    return {
      alertLabel: "[有人 @ 我]",
      description: messageDescription,
    }
  }

  if (draftText !== undefined) {
    return {
      alertLabel: "[草稿]",
      description: draftText,
    }
  }

  return {
    alertLabel: null,
    description: messageDescription,
  }
}

function ConversationListAvatar({
  conversation,
}: {
  conversation: ClientConversation
}) {
  const sourceSender = conversation.topic?.sourceSender
  return (
    <div className="relative shrink-0">
      {conversation.type === "topic" && sourceSender ? (
        <Avatar className="size-8 rounded-full bg-muted after:rounded-full">
          {sourceSender.avatar && (
            <AvatarImage
              alt={sourceSender.name}
              className="rounded-full"
              src={sourceSender.avatar}
            />
          )}
          <AvatarFallback
            aria-label={sourceSender.name}
            className="rounded-full"
          >
            {sourceSender.type === "app" ? (
              <Bot className="size-1/2" />
            ) : (
              getConversationInitial(sourceSender.name)
            )}
          </AvatarFallback>
        </Avatar>
      ) : (
        <ConversationAvatar className="size-10" conversation={conversation} />
      )}
      {conversation.unreadCount > 0 && (
        <span className="absolute top-0 right-0 z-10 translate-x-1/3 -translate-y-1/3">
          {conversation.notificationMuted ? (
            <span
              aria-label="有未读消息"
              className="block size-2 rounded-full bg-red-500"
            />
          ) : (
            <ConversationUnreadBadge count={conversation.unreadCount} />
          )}
        </span>
      )}
    </div>
  )
}

function getConversationInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}

function ConversationUnreadBadge({ count }: { count: number }) {
  return (
    <Badge
      aria-label={`${count} 条未读消息`}
      className="h-4 bg-red-500 px-1 py-0 text-[10px] leading-4 font-normal text-white hover:bg-red-500 dark:bg-red-500"
      variant="destructive"
    >
      {formatUnreadCount(count)}
    </Badge>
  )
}

function formatUnreadCount(count: number) {
  if (count > 99) {
    return "99+"
  }

  return String(count)
}
