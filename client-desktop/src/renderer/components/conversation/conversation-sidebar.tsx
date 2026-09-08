import * as React from "react"
import { BellOff, Bot, Pin, Plus } from "lucide-react"
import { toast } from "sonner"

import { ConversationListItemMenu } from "@/components/conversation-list-item-menu"
import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { GlobalSearchCommand } from "@/components/global-search-command"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VirtualList } from "@/components/ui/virtual-list"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenuButton } from "@/components/ui/sidebar"
import { formatActivityTime } from "@/lib/activity-time"
import { getAvatarInitial } from "@/lib/avatar"
import type {
  ClientConversation,
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
} from "@/lib/client-data-state"
import { createConversationMentionLabelResolver } from "@/lib/conversation-mention-labels"
import type { ConversationDrafts } from "@/lib/conversation-drafts"
import { useLocale } from "@/components/locale-provider"
import type { DirectorySearchItem } from "@/lib/local-search"
import { formatMentionTemplateText, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"

const conversationFilterOptions = [
  { label: "sidebar.filter.all", value: "all" },
  { label: "sidebar.filter.unread", value: "unread" },
  { label: "sidebar.filter.direct", value: "direct" },
  { label: "sidebar.filter.group", value: "group" },
] as const
type ConversationFilter = (typeof conversationFilterOptions)[number]["value"]
type ConversationListRow = { conversation: ClientConversation; nested: boolean }

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
  onCreateGroup,
  onAddFriend,
  onDismissConversation,
  onSelectDirectoryItem = () => undefined,
  onSelectMessageResult,
  onSelectConversation,
  onSetConversationMuted,
  onSetConversationPinned,
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
  onCreateGroup: () => void
  onAddFriend?: () => void
  onDismissConversation?: (conversationId: string) => Promise<void>
  onSelectDirectoryItem?: (item: DirectorySearchItem) => void
  onSelectMessageResult?: (result: ClientMessageSearchResult) => void
  onSelectConversation: (conversationId: string) => void
  onSetConversationMuted: (conversationId: string, muted: boolean) => Promise<void>
  onSetConversationPinned: (conversationId: string, pinned: boolean) => Promise<void>
}) {
  const { t } = useLocale()
  const [mutingConversationId, setMutingConversationId] = React.useState("")
  const [pinningConversationId, setPinningConversationId] = React.useState("")
  const [dismissingConversationId, setDismissingConversationId] = React.useState("")
  const [dismissCandidate, setDismissCandidate] = React.useState<ClientConversation | null>(null)
  const [conversationFilter, setConversationFilter] = React.useState<ConversationFilter>("all")
  const [listNow, setListNow] = React.useState(() => Date.now())
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const interval = window.setInterval(() => setListNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const visibleRows = React.useMemo(
    () => getConversationListRows(conversations, activeConversationId, conversationFilter, listNow),
    [activeConversationId, conversationFilter, conversations, listNow],
  )

  async function handlePinnedChange(conversation: ClientConversation, pinned: boolean) {
    if (pinningConversationId) {
      return
    }
    setPinningConversationId(conversation.id)
    try {
      await onSetConversationPinned(conversation.id, pinned)
      toast.success(pinned ? t("sidebar.pinned.toast") : t("sidebar.unpinned.toast"))
    } catch (error) {
      toast.error(
        getClientDataErrorMessage(error, pinned ? t("sidebar.pinError") : t("sidebar.unpinError")),
      )
    } finally {
      setPinningConversationId("")
    }
  }

  async function handleMutedChange(conversation: ClientConversation, muted: boolean) {
    if (mutingConversationId) {
      return
    }
    setMutingConversationId(conversation.id)
    try {
      await onSetConversationMuted(conversation.id, muted)
      toast.success(muted ? t("sidebar.muted.toast") : t("sidebar.unmuted.toast"))
    } catch (error) {
      toast.error(
        getClientDataErrorMessage(error, muted ? t("sidebar.muteError") : t("sidebar.unmuteError")),
      )
    } finally {
      setMutingConversationId("")
    }
  }

  async function handleDismissConversation() {
    if (!dismissCandidate || dismissingConversationId || !onDismissConversation) {
      return
    }
    const conversation = dismissCandidate
    setDismissingConversationId(conversation.id)
    try {
      await onDismissConversation(conversation.id)
      setDismissCandidate(null)
      toast.success(t("sidebar.dismissed.toast"))
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, t("sidebar.dismissError")))
    } finally {
      setDismissingConversationId("")
    }
  }

  function handleConversationListContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target

    if (target instanceof Element && target.closest("[data-conversation-list-item-trigger]")) {
      return
    }

    event.preventDefault()
  }

  function renderConversationItem({ conversation, nested }: ConversationListRow) {
    const selected = conversation.id === activeConversationId
    const lastMessageTime = formatActivityTime(conversation.lastMessageAt ?? conversation.createdAt)
    const mentionLabelResolver = createConversationMentionLabelResolver({
      appsById,
      contactsById,
      conversation,
      currentUser,
    })
    const hasUnreadMention = conversation.lastMentionedSeq > conversation.lastReadSeq
    const preview = getConversationListPreview({
      draftText: conversation.topic?.archived ? undefined : drafts[conversation.id]?.text,
      hasUnreadMention,
      hasUnreadChoice: conversation.lastChoiceSeq > conversation.lastReadSeq,
      lastChoiceSeq: conversation.lastChoiceSeq,
      lastMentionedSeq: conversation.lastMentionedSeq,
      messageDescription: getConversationListDescription(
        conversation,
        currentUser.id,
        mentionLabelResolver,
        t,
      ),
      selected,
      t,
    })

    return (
      <ConversationListItemMenu
        dismissing={dismissingConversationId === conversation.id}
        key={conversation.id}
        muted={Boolean(conversation.notificationMuted)}
        muting={mutingConversationId === conversation.id}
        onDismiss={() => setDismissCandidate(conversation)}
        onMutedChange={(muted) => void handleMutedChange(conversation, muted)}
        onPinnedChange={(pinned) => void handlePinnedChange(conversation, pinned)}
        pinned={!nested && Boolean(conversation.pinned)}
        pinning={pinningConversationId === conversation.id}
        showPinAction={!nested && !isBuiltinAssistantConversation(conversation)}
      >
        <div className="group/menu-item relative" data-conversation-list-item-trigger>
          <SidebarMenuButton
            aria-selected={selected}
            className={cn(
              "workspace-conversation-row h-16 gap-3 py-2 data-active:bg-primary/10 data-active:hover:bg-primary/10 dark:data-active:bg-primary/15 dark:data-active:hover:bg-primary/15",
              nested && "ml-4 h-14 w-[calc(100%-1rem)] py-1.5",
              !nested &&
                conversation.pinned &&
                "bg-neutral-100 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-900",
            )}
            isActive={selected}
            onClick={() => onSelectConversation(conversation.id)}
            role="option"
            size="lg"
            type="button"
          >
            <ConversationListAvatar conversation={conversation} />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden text-sm leading-snug font-medium underline-offset-4">
                <span className="flex min-w-0 flex-1 items-center overflow-hidden">
                  <span className="block min-w-0 flex-1 truncate">
                    {nested ? conversation.name : getConversationDisplayName(conversation)}
                  </span>
                  {conversation.topic?.archived && (
                    <span className="ml-1.5 shrink-0 text-[10px] font-normal text-muted-foreground">
                      {t("sidebar.archived")}
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
                {((!nested && conversation.pinned) || conversation.notificationMuted) && (
                  <span className="mr-2 flex shrink-0 items-center gap-0.5">
                    {!nested && conversation.pinned && (
                      <Pin aria-label={t("sidebar.pinned")} className="size-3! shrink-0" />
                    )}
                    {conversation.notificationMuted && (
                      <BellOff aria-label={t("sidebar.muted.toast")} className="size-3! shrink-0" />
                    )}
                  </span>
                )}
              </p>
            </div>
          </SidebarMenuButton>
        </div>
      </ConversationListItemMenu>
    )
  }

  return (
    <Sidebar
      className="workspace-section-sidebar workspace-conversation-sidebar border-r bg-background"
      collapsible="none"
    >
      <SidebarHeader className="conversation-sidebar-header-surface gap-0 p-0">
        <div
          className="workspace-section-heading flex h-14 items-center justify-between px-4"
          data-desktop-drag-region="true"
        >
          <h1 className="text-base font-medium">{t("sidebar.title")}</h1>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("sidebar.newAgent")}
                  size="icon-sm"
                  title={t("sidebar.newAgent")}
                  type="button"
                  variant="ghost"
                >
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onSelect={onCreateGroup}>
                  {t("sidebar.startGroup")}
                </DropdownMenuItem>
                {onAddFriend && (
                  <DropdownMenuItem onSelect={onAddFriend}>
                    {t("sidebar.addFriend")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="workspace-search-row px-4 pb-3">
          <GlobalSearchCommand
            expanded
            contactApps={contactApps}
            contactGroups={contactGroups}
            contacts={contacts}
            conversations={conversations}
            currentUserId={currentUser.id}
            onSelectConversation={onSelectConversation}
            onSelectDirectoryItem={onSelectDirectoryItem}
            onSelectMessageResult={onSelectMessageResult}
          />
        </div>
        <div className="workspace-conversation-filters px-4 pb-3">
          <Tabs
            className="gap-0"
            onValueChange={(value) => setConversationFilter(value as ConversationFilter)}
            value={conversationFilter}
          >
            <TabsList
              aria-label={t("sidebar.conversationType")}
              className="grid w-full grid-cols-4"
            >
              {conversationFilterOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {t(option.label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </SidebarHeader>
      <SidebarContent ref={scrollRef} onContextMenu={handleConversationListContextMenu}>
        {visibleRows.length === 0 ? (
          <div className="px-2 pb-3" role="listbox">
            <div className="group/menu-item relative">
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {getEmptyConversationFilterMessage(conversationFilter, t)}
              </div>
            </div>
          </div>
        ) : (
          <VirtualList
            className="flex flex-col gap-1 px-2 pb-3"
            estimateSize={68}
            getKey={(row) => row.conversation.id}
            items={visibleRows}
            renderItem={renderConversationItem}
            role="listbox"
            scrollRef={scrollRef}
          />
        )}
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
            <AlertDialogTitle>{t("sidebar.dismiss.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("sidebar.dismiss.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(dismissingConversationId)}>
              {t("sidebar.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(dismissingConversationId)}
              onClick={(event) => {
                event.preventDefault()
                void handleDismissConversation()
              }}
              variant="destructive"
            >
              {dismissingConversationId ? t("sidebar.dismissing") : t("sidebar.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  )
}

function getConversationListDescription(
  conversation: ClientConversation,
  currentUserId: string,
  mentionLabelResolver: MentionLabelResolver,
  t: ReturnType<typeof useLocale>["t"],
) {
  const summary = conversation.lastMessageSummary.trim()

  if (!summary) {
    return t("sidebar.noMessages")
  }

  const description = formatMentionTemplateText(summary, mentionLabelResolver)
  const showsSender =
    conversation.type === "group" ||
    (conversation.type === "topic" && conversation.topic?.parentConversationType === "group")
  if (!showsSender) {
    return description
  }

  const senderName = getLastMessageSenderName(conversation, currentUserId, t)
  return senderName ? `${senderName}：${description}` : description
}

function getLastMessageSenderName(
  conversation: ClientConversation,
  currentUserId: string,
  t: ReturnType<typeof useLocale>["t"],
) {
  const sender = conversation.lastMessageSender
  if (!sender) {
    return ""
  }
  if (sender.type === "system") {
    return t("sidebar.system")
  }
  if (sender.type === "user" && sender.id === currentUserId) {
    return t("sidebar.me")
  }

  return sender.nickname.trim() || sender.name.trim()
}

function getConversationListPreview({
  draftText,
  hasUnreadMention,
  hasUnreadChoice,
  lastChoiceSeq,
  lastMentionedSeq,
  messageDescription,
  selected,
  t,
}: {
  draftText: string | undefined
  hasUnreadMention: boolean
  hasUnreadChoice: boolean
  lastChoiceSeq: number
  lastMentionedSeq: number
  messageDescription: string
  selected: boolean
  t: ReturnType<typeof useLocale>["t"]
}) {
  if (selected) {
    return {
      alertLabel: null,
      description: messageDescription,
    }
  }

  if (hasUnreadChoice && lastChoiceSeq >= lastMentionedSeq) {
    return {
      alertLabel: t("sidebar.alert.choice"),
      description: messageDescription.replace(/(^|[:：])\[(?:选择|Choice)\]\s*/, "$1"),
    }
  }

  if (hasUnreadMention) {
    return {
      alertLabel: t("sidebar.alert.mention"),
      description: messageDescription,
    }
  }

  if (draftText !== undefined) {
    return {
      alertLabel: t("sidebar.alert.draft"),
      description: draftText,
    }
  }

  return {
    alertLabel: null,
    description: messageDescription,
  }
}

function getConversationListRows(
  conversations: ClientConversation[],
  activeConversationId: string,
  filter: ConversationFilter,
  now: number,
): ConversationListRow[] {
  const ordered = orderConversations(conversations, now)
  const parents = new Set(
    ordered.filter((conversation) => conversation.type !== "topic").map(({ id }) => id),
  )
  const topicsByParent = new Map<string, ClientConversation[]>()
  for (const conversation of ordered) {
    if (
      conversation.type !== "topic" ||
      !isConversationTopicVisibleInList(conversation, { activeConversationId, now })
    ) {
      continue
    }
    const parentId = conversation.topic?.parentConversationId
    if (!parentId || !parents.has(parentId)) continue
    const topics = topicsByParent.get(parentId) ?? []
    topics.push(conversation)
    topicsByParent.set(parentId, topics)
  }

  const rows: ConversationListRow[] = []
  for (const conversation of ordered) {
    if (conversation.type === "topic") continue
    const topics = topicsByParent.get(conversation.id) ?? []
    if (filter === "unread") {
      const unreadTopics = topics.filter(hasUnreadMessages)
      if (!hasUnreadMessages(conversation) && unreadTopics.length === 0) continue
      rows.push({ conversation, nested: false })
      rows.push(...unreadTopics.map((topic) => ({ conversation: topic, nested: true })))
      continue
    }
    const matches =
      filter === "all" ||
      conversation.type === filter ||
      (filter === "direct" && conversation.type === "app")
    if (!matches) continue
    rows.push({ conversation, nested: false })
    rows.push(...topics.map((topic) => ({ conversation: topic, nested: true })))
  }
  return rows
}

function hasUnreadMessages(conversation: ClientConversation) {
  return (
    conversation.unreadCount > 0 ||
    conversation.lastMessageSeq > conversation.lastReadSeq ||
    conversation.lastChoiceSeq > conversation.lastReadSeq
  )
}

function getEmptyConversationFilterMessage(
  filter: ConversationFilter,
  t: ReturnType<typeof useLocale>["t"],
) {
  if (filter === "all") return t("sidebar.noConversations")
  const label =
    conversationFilterOptions.find((option) => option.value === filter)?.label ??
    "sidebar.conversation"
  return t("sidebar.noConversationsOf", { label: t(label) })
}

function ConversationListAvatar({ conversation }: { conversation: ClientConversation }) {
  const { t } = useLocale()
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
          <AvatarFallback aria-label={sourceSender.name} className="rounded-full">
            {sourceSender.type === "app" ? (
              <Bot className="size-4" />
            ) : (
              getAvatarInitial(sourceSender.name)
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
              aria-label={t("sidebar.unreadMessage")}
              className="block size-2 rounded-full bg-rose-700"
            />
          ) : (
            <ConversationUnreadBadge count={conversation.unreadCount} />
          )}
        </span>
      )}
    </div>
  )
}

function ConversationUnreadBadge({ count }: { count: number }) {
  const { t } = useLocale()
  return (
    <Badge
      aria-label={t("sidebar.unreadCount", { count })}
      className="h-4 bg-rose-700 px-1 py-0 text-[10px] leading-4 font-normal text-white dark:bg-rose-700"
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
