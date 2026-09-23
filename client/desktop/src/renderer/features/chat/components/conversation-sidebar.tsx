import { useState } from "react"
import {
  ArrowMoveDownRightIcon,
  Delete02Icon,
  Loading03Icon,
  Notification01Icon,
  NotificationOff01Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons"
import type { DesktopConversation, LocalSearchResult } from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { SidebarSearchHeader } from "@/components/sidebar-search-header"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { parseMentionTemplate, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { groupConversationList } from "../conversation-list-order"
import { canPinConversation } from "../conversation-action-policy"

export function ConversationSidebar({
  conversations,
  loading,
  selectedId,
  targetId,
  resolvedTheme,
  mentionLabelResolver,
  onSelect,
  onCreateGroup,
  onCreateApp,
  onRefresh,
  onSelectSearchResult,
  onSetPinned,
  onSetMuted,
  onDismiss,
}: {
  conversations: DesktopConversation[]
  loading: boolean
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelect: (id: string) => void
  onCreateGroup: () => void
  onCreateApp: () => void
  onRefresh: () => void
  onSelectSearchResult: (result: LocalSearchResult) => void
  onSetPinned: (conversationId: string, pinned: boolean) => Promise<void>
  onSetMuted: (conversationId: string, muted: boolean) => Promise<void>
  onDismiss: (conversationId: string) => Promise<void>
}) {
  const { showToast } = useAnimatedToast()
  const { pinned, regular } = groupConversationList(conversations)
  const [pendingAction, setPendingAction] = useState<PendingConversationAction>(null)
  const [dismissCandidate, setDismissCandidate] = useState<DesktopConversation | null>(null)

  async function updatePinned(conversation: DesktopConversation) {
    if (pendingAction) return
    const pinned = !conversation.pinned
    setPendingAction({ conversationId: conversation.id, type: "pin" })
    try {
      await onSetPinned(conversation.id, pinned)
      showToast({ status: "success", title: pinned ? "会话已置顶" : "已取消置顶" })
    } catch (error) {
      showToast({
        status: "error",
        title: pinned ? "置顶会话失败" : "取消置顶失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function updateMuted(conversation: DesktopConversation) {
    if (pendingAction) return
    const muted = !conversation.notificationMuted
    setPendingAction({ conversationId: conversation.id, type: "mute" })
    try {
      await onSetMuted(conversation.id, muted)
      showToast({ status: "success", title: muted ? "已开启免打扰" : "已取消免打扰" })
    } catch (error) {
      showToast({
        status: "error",
        title: muted ? "开启免打扰失败" : "取消免打扰失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function dismissConversation() {
    if (!dismissCandidate || pendingAction) return
    setPendingAction({ conversationId: dismissCandidate.id, type: "dismiss" })
    try {
      await onDismiss(dismissCandidate.id)
      setDismissCandidate(null)
      showToast({ status: "success", title: "对话已删除" })
    } catch (error) {
      showToast({
        status: "error",
        title: "删除对话失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const dismissing = pendingAction?.type === "dismiss"

  return (
    <>
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar">
        <SidebarSearchHeader
          searchLabel="搜索会话"
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
          <nav className="min-h-full" aria-label="对话列表">
            {loading ? (
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
              <>
                {pinned.length > 0 && (
                  <div className="bg-xgui-background-0 px-2 py-1">
                    <ConversationGroup
                      conversations={pinned}
                      selectedId={selectedId}
                      targetId={targetId}
                      resolvedTheme={resolvedTheme}
                      mentionLabelResolver={mentionLabelResolver}
                      pendingAction={pendingAction}
                      onPinnedChange={(conversation) => void updatePinned(conversation)}
                      onMutedChange={(conversation) => void updateMuted(conversation)}
                      onRequestDismiss={setDismissCandidate}
                      onSelect={onSelect}
                    />
                  </div>
                )}
                {regular.length > 0 && (
                  <div className="px-2 py-1">
                    <ConversationGroup
                      conversations={regular}
                      selectedId={selectedId}
                      targetId={targetId}
                      resolvedTheme={resolvedTheme}
                      mentionLabelResolver={mentionLabelResolver}
                      pendingAction={pendingAction}
                      onPinnedChange={(conversation) => void updatePinned(conversation)}
                      onMutedChange={(conversation) => void updateMuted(conversation)}
                      onRequestDismiss={setDismissCandidate}
                      onSelect={onSelect}
                    />
                  </div>
                )}
              </>
            )}
          </nav>
        </ScrollArea>
      </aside>
      <AlertDialog
        open={Boolean(dismissCandidate)}
        onOpenChange={(open) => {
          if (!open && !dismissing) setDismissCandidate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后，该对话将暂时从列表中移除。收到新消息后会重新显示，聊天记录不会删除，也不会退出群聊。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissing}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={dismissing}
              onClick={(event) => {
                event.preventDefault()
                void dismissConversation()
              }}
            >
              {dismissing ? "正在删除" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type PendingConversationAction = {
  conversationId: string
  type: "pin" | "mute" | "dismiss"
} | null

function ConversationGroup({
  conversations,
  selectedId,
  targetId,
  resolvedTheme,
  mentionLabelResolver,
  pendingAction,
  onPinnedChange,
  onMutedChange,
  onRequestDismiss,
  onSelect,
}: {
  conversations: DesktopConversation[]
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  pendingAction: PendingConversationAction
  onPinnedChange: (conversation: DesktopConversation) => void
  onMutedChange: (conversation: DesktopConversation) => void
  onRequestDismiss: (conversation: DesktopConversation) => void
  onSelect: (id: string) => void
}) {
  return (
    <ItemGroup className="has-data-[size=sm]:gap-1">
      {conversations.map((conversation) => {
        const active = conversation.id === selectedId
        const pending = pendingAction?.conversationId === conversation.id
        const pinning = pending && pendingAction.type === "pin"
        const muting = pending && pendingAction.type === "mute"
        return (
          <ContextMenu key={conversation.id}>
            <ContextMenuTrigger asChild>
              <Item
                asChild
                variant="default"
                size="sm"
                className={cn(
                  "relative flex-nowrap border-transparent text-left hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground",
                  conversation.type === "topic" && "py-1.5 pl-6",
                  active &&
                    "bg-xgui-brand-1 text-sidebar-accent-foreground hover:bg-xgui-brand-1 hover:text-sidebar-accent-foreground",
                )}
              >
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSelect(conversation.id)}
                >
                  {conversation.type === "topic" && (
                    <HugeiconsIcon
                      icon={ArrowMoveDownRightIcon}
                      className="absolute left-3.5 size-2.5 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <ConversationListAvatar
                    conversation={conversation}
                    targetId={targetId}
                    resolvedTheme={resolvedTheme}
                  />
                  <ItemContent className="w-0 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className={cn(
                          "min-w-0 flex-1 truncate leading-snug font-medium",
                          conversation.type === "topic" ? "text-xs" : "text-sm",
                        )}
                      >
                        {conversation.name}
                      </div>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {formatConversationTime(
                          conversation.lastMessageAt ?? conversation.createdAt,
                        )}
                      </span>
                    </div>
                    <p className="flex min-w-0 items-center gap-0.5 text-left text-xs leading-normal font-normal text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {formatConversationSummary(
                          conversation.lastMessageSummary,
                          mentionLabelResolver,
                        )}
                      </span>
                      {conversation.notificationMuted && (
                        <HugeiconsIcon
                          icon={NotificationOff01Icon}
                          className="size-2.5 shrink-0"
                          aria-label="消息免打扰"
                        />
                      )}
                    </p>
                  </ItemContent>
                </button>
              </Item>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {canPinConversation(conversation) && (
                <ContextMenuItem
                  className="hover:bg-accent hover:text-accent-foreground"
                  disabled={Boolean(pendingAction)}
                  onSelect={() => onPinnedChange(conversation)}
                >
                  <HugeiconsIcon
                    icon={pinning ? Loading03Icon : conversation.pinned ? PinOffIcon : PinIcon}
                    className={cn("size-4", pinning && "animate-spin")}
                    aria-hidden
                  />
                  {conversation.pinned ? "取消置顶" : "置顶"}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                className="hover:bg-accent hover:text-accent-foreground"
                disabled={Boolean(pendingAction)}
                onSelect={() => onMutedChange(conversation)}
              >
                <HugeiconsIcon
                  icon={
                    muting
                      ? Loading03Icon
                      : conversation.notificationMuted
                        ? Notification01Icon
                        : NotificationOff01Icon
                  }
                  className={cn("size-4", muting && "animate-spin")}
                  aria-hidden
                />
                {conversation.notificationMuted ? "取消免打扰" : "消息免打扰"}
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                className="hover:bg-destructive/10 hover:text-destructive"
                disabled={Boolean(pendingAction)}
                onSelect={() => onRequestDismiss(conversation)}
              >
                <HugeiconsIcon icon={Delete02Icon} className="size-4" aria-hidden />
                删除对话
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </ItemGroup>
  )
}

function ConversationListAvatar({
  conversation,
  targetId,
  resolvedTheme,
}: {
  conversation: DesktopConversation
  targetId: string
  resolvedTheme: "light" | "dark"
}) {
  const isTopic = conversation.type === "topic"
  const sourceSender = isTopic ? conversation.topic?.sourceSender : undefined
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center", isTopic ? "size-7" : "size-10")}
    >
      {isTopic ? (
        <div className="relative size-6">
          <EntityAvatar
            targetId={targetId}
            type={conversation.avatarType}
            id={conversation.avatarId}
            theme={resolvedTheme}
            size={24}
            label={`${conversation.name}头像`}
          />
          {sourceSender && (
            <span className="absolute -right-1 -bottom-1 flex rounded-full bg-background p-0.5 leading-none shadow-xs">
              <EntityAvatar
                targetId={targetId}
                type={sourceSender.type}
                id={sourceSender.id}
                theme={resolvedTheme}
                size={12}
                label={`${sourceSender.name}头像`}
                className="rounded-full"
              />
            </span>
          )}
        </div>
      ) : (
        <EntityAvatar
          targetId={targetId}
          type={conversation.avatarType}
          id={conversation.avatarId}
          theme={resolvedTheme}
          size={40}
          label={`${conversation.name}头像`}
        />
      )}
    </div>
  )
}

function formatConversationSummary(summary: string, mentionLabelResolver: MentionLabelResolver) {
  if (!summary) return "暂无消息"
  return parseMentionTemplate(summary, mentionLabelResolver)
    .map((part) => (part.type === "text" ? part.text : part.label))
    .join("")
}

function formatConversationTime(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  }
  return `${twoDigits(date.getMonth() + 1)}/${twoDigits(date.getDate())}`
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0")
}
