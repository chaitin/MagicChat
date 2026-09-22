import {
  ArrowMoveDownRightIcon,
  Loading03Icon,
  NotificationOff01Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopConversation, LocalSearchResult } from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { SidebarSearchHeader } from "@/components/sidebar-search-header"
import { Item, ItemContent, ItemGroup } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { parseMentionTemplate, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { groupConversationList } from "../conversation-list-order"

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
}) {
  const { pinned, regular } = groupConversationList(conversations)

  return (
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
                    onSelect={onSelect}
                  />
                </div>
              )}
            </>
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}

function ConversationGroup({
  conversations,
  selectedId,
  targetId,
  resolvedTheme,
  mentionLabelResolver,
  onSelect,
}: {
  conversations: DesktopConversation[]
  selectedId: string | null
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onSelect: (id: string) => void
}) {
  return (
    <ItemGroup className="has-data-[size=sm]:gap-1">
      {conversations.map((conversation) => {
        const active = conversation.id === selectedId
        return (
          <Item
            key={conversation.id}
            asChild
            variant="default"
            size="sm"
            className={cn(
              "relative flex-nowrap border-transparent text-left hover:bg-foreground/5 hover:text-foreground",
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
                    {formatConversationTime(conversation.lastMessageAt ?? conversation.createdAt)}
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
