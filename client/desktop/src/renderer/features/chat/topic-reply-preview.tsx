import { MessageMultiple02Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessage } from "../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import {
  mentionClassName,
  parseMentionTemplate,
  type MentionLabelResolver,
} from "@/lib/message-mentions"

type Topic = NonNullable<DesktopMessage["topic"]>

export function TopicReplyPreview({
  topic,
  targetId,
  currentUserId,
  currentUserName,
  resolvedTheme,
  mentionLabelResolver,
  onOpen,
}: {
  topic: Topic
  targetId: string
  currentUserId: string
  currentUserName: string
  resolvedTheme: "light" | "dark"
  mentionLabelResolver: MentionLabelResolver
  onOpen: () => void
}) {
  const latestReplyTime = formatTopicReplyTime(topic.recentReplies.at(-1)?.createdAt ?? "")

  return (
    <div className="mt-3 w-120 max-w-full border-t border-foreground/10 pt-2">
      {topic.recentReplies.length > 0 && (
        <>
          <div className="w-full space-y-1.5">
            {topic.recentReplies.map((reply) => {
              const author = topicReplyAuthor(
                reply.senderId,
                reply.senderType,
                currentUserId,
                currentUserName,
                mentionLabelResolver,
              )
              return (
                <div className="flex min-w-0 items-center gap-2" key={reply.id}>
                  <EntityAvatar
                    targetId={targetId}
                    type={reply.senderType}
                    id={reply.senderId}
                    theme={resolvedTheme}
                    size={20}
                    label={`${author}头像`}
                  />
                  <div className="min-w-0 truncate text-xs">
                    <span className="font-medium text-foreground/90">{author}</span>
                    <span className="text-muted-foreground">：</span>
                    <TopicReplySummary
                      summary={reply.summary}
                      currentUserId={currentUserId}
                      mentionLabelResolver={mentionLabelResolver}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="h-3" />
        </>
      )}
      <div className="flex w-full items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-xgui-link outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={onOpen}
        >
          <HugeiconsIcon icon={MessageMultiple02Icon} className="size-4" aria-hidden />
          查看话题
        </button>
        {latestReplyTime && (
          <span className="shrink-0 text-xs text-muted-foreground">{latestReplyTime}</span>
        )}
      </div>
    </div>
  )
}

function TopicReplySummary({
  summary,
  currentUserId,
  mentionLabelResolver,
}: {
  summary: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
}) {
  return (
    <span className="text-muted-foreground">
      {parseMentionTemplate(summary, mentionLabelResolver).map((part, index) =>
        part.type === "mention" ? (
          <span key={index} className={mentionClassName(part.targetType, part.id, currentUserId)}>
            {part.label}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  )
}

function topicReplyAuthor(
  senderId: string,
  senderType: "user" | "app",
  currentUserId: string,
  currentUserName: string,
  resolveLabel: MentionLabelResolver,
) {
  if (senderType === "user" && senderId.toLowerCase() === currentUserId.toLowerCase()) {
    return currentUserName
  }
  const label = resolveLabel({ id: senderId, type: senderType })?.trim()
  return label || (senderType === "app" ? "应用" : "成员")
}

function formatTopicReplyTime(createdAt: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ""
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0")
}
