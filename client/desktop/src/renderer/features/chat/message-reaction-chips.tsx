import { useMemo, useRef, useState } from "react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessage, DesktopMessageReactionUser } from "../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { MentionLabelResolver } from "@/lib/message-mentions"

type Reaction = DesktopMessage["reactions"][number]

export function MessageReactionChips({
  targetId,
  conversationId,
  messageId,
  reactions,
  pendingKeys,
  resolveLabel,
  onSetReaction,
}: {
  targetId: string
  conversationId: string
  messageId: string
  reactions: DesktopMessage["reactions"]
  pendingKeys: ReadonlySet<string>
  resolveLabel: MentionLabelResolver
  onSetReaction: (text: string, reacted: boolean) => Promise<void>
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {reactions.map((reaction) => {
        const pending = pendingKeys.has(`${messageId}\0${reaction.text}`)
        return (
          <div
            key={reaction.text}
            className="inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md bg-background/70 px-2 py-0.5 text-xs text-foreground"
          >
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-sm outline-none transition-opacity hover:opacity-70 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-50"
              disabled={pending}
              aria-label={`${reaction.reactedByMe ? "移除" : "添加"}表情 ${reaction.text}`}
              onClick={() => void onSetReaction(reaction.text, !reaction.reactedByMe)}
            >
              <span className="font-emoji">{reaction.text}</span>
            </button>
            <ReactionParticipantSummary
              targetId={targetId}
              conversationId={conversationId}
              messageId={messageId}
              reaction={reaction}
              resolveLabel={resolveLabel}
            />
          </div>
        )
      })}
    </div>
  )
}

function ReactionParticipantSummary({
  targetId,
  conversationId,
  messageId,
  reaction,
  resolveLabel,
}: {
  targetId: string
  conversationId: string
  messageId: string
  reaction: Reaction
  resolveLabel: MentionLabelResolver
}) {
  const users = useMemo(
    () => reaction.users.map((user) => resolvedUser(user, resolveLabel)),
    [reaction.users, resolveLabel],
  )
  if (users.length === 0) {
    return (
      <ReactionUsersPopover
        targetId={targetId}
        conversationId={conversationId}
        messageId={messageId}
        reaction={reaction}
        resolveLabel={resolveLabel}
      />
    )
  }
  const hasMoreUsers = reaction.count > users.length
  return (
    <span className="inline-flex min-w-0 flex-1 flex-wrap items-center">
      {users.map((user, index) => (
        <span className="inline-flex min-w-0 items-center" key={user.id}>
          {index > 0 && <span>,&nbsp;</span>}
          <span className="min-w-0 max-w-full break-all whitespace-normal">{user.name}</span>
        </span>
      ))}
      {hasMoreUsers && (
        <span className="inline-flex items-center whitespace-nowrap">
          <span>等&nbsp;</span>
          <ReactionUsersPopover
            targetId={targetId}
            conversationId={conversationId}
            messageId={messageId}
            reaction={reaction}
            resolveLabel={resolveLabel}
          />
          <span>&nbsp;人</span>
        </span>
      )}
    </span>
  )
}

function ReactionUsersPopover({
  targetId,
  conversationId,
  messageId,
  reaction,
  resolveLabel,
}: {
  targetId: string
  conversationId: string
  messageId: string
  reaction: Reaction
  resolveLabel: MentionLabelResolver
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [users, setUsers] = useState<DesktopMessageReactionUser[]>([])
  const requestVersionRef = useRef(0)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    const requestVersion = ++requestVersionRef.current
    if (!nextOpen || !window.desktop) return
    setLoading(true)
    setError("")
    void window.desktop.accountData
      .listMessageReactionUsers({
        targetId,
        conversationId,
        messageId,
        text: reaction.text,
      })
      .then((result) => {
        if (requestVersionRef.current !== requestVersion) return
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setUsers(result.data.map((user) => resolvedUser(user, resolveLabel)))
      })
      .catch(() => {
        if (requestVersionRef.current === requestVersion) setError("加载参与者失败")
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) setLoading(false)
      })
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer rounded-sm font-medium text-xgui-link outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`查看表情 ${reaction.text} 的 ${reaction.count} 位参与者`}
        >
          {reaction.count}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 p-0">
        <div className="border-b px-4 py-3 text-sm font-medium">
          <span className="font-emoji">{reaction.text}</span> 的参与者（{reaction.count}）
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
              正在加载
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{error}</div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无参与者</div>
          ) : (
            <div className="grid gap-0.5">
              {users.map((user) => (
                <div key={user.id} className="truncate rounded-md px-2 py-2 text-sm">
                  {user.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function resolvedUser(user: DesktopMessageReactionUser, resolveLabel: MentionLabelResolver) {
  return {
    ...user,
    name: resolveLabel({ type: "user", id: user.id }) || user.name || "未知用户",
  }
}
