import * as React from "react"
import { LoaderCircle, MessagesSquare } from "lucide-react"

import {
  listConversationTopics,
  type ClientConversation,
} from "@/lib/client-data-api"
import { formatActivityTime } from "@/lib/activity-time"
import { getAvatarInitial } from "@/lib/avatar"
import { useOptionalClientData } from "@/lib/client-data-context"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
const topicPageLimit = 50

export function ConversationTopicsDialog({
  conversation,
  onOpenTopic,
}: {
  conversation: ClientConversation
  onOpenTopic: (conversationId: string) => void
}) {
  const clientData = useOptionalClientData()
  const ensureUsers = clientData?.ensureUsers
  const [open, setOpen] = React.useState(false)
  const [topics, setTopics] = React.useState<ClientConversation[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState("")
  const requestVersionRef = React.useRef(0)

  const requestTopics = React.useCallback(
    async (cursor: string | undefined) => {
      const page = await listConversationTopics(conversation.id, {
        cursor,
        limit: topicPageLimit,
      })
      const sourceUserIds = page.topics.flatMap((topic) => {
        const sender = topic.topic?.sourceSender
        return sender?.type === "user" && sender.id ? [sender.id] : []
      })
      if (sourceUserIds.length > 0) {
        void ensureUsers?.([...new Set(sourceUserIds)]).catch(() => undefined)
      }
      return page
    },
    [conversation.id, ensureUsers]
  )

  const loadTopics = React.useCallback(
    async (cursor: string | undefined, append: boolean) => {
      const requestVersion = ++requestVersionRef.current
      try {
        const page = await requestTopics(cursor)
        if (requestVersionRef.current !== requestVersion) return
        setTopics((current) =>
          append ? mergeTopics(current, page.topics) : page.topics
        )
        setNextCursor(page.nextCursor)
      } catch (requestError) {
        if (requestVersionRef.current !== requestVersion) return
        setError(getClientDataErrorMessage(requestError, "加载话题列表失败"))
      } finally {
        if (requestVersionRef.current === requestVersion) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [requestTopics]
  )

  React.useEffect(() => {
    if (!open || conversation.type === "topic") return
    const requestVersion = ++requestVersionRef.current
    void requestTopics(undefined)
      .then((page) => {
        if (requestVersionRef.current !== requestVersion) return
        setTopics(page.topics)
        setNextCursor(page.nextCursor)
      })
      .catch((requestError) => {
        if (requestVersionRef.current !== requestVersion) return
        setError(getClientDataErrorMessage(requestError, "加载话题列表失败"))
      })
      .finally(() => {
        if (requestVersionRef.current === requestVersion) setLoading(false)
      })
    return () => {
      requestVersionRef.current += 1
    }
  }, [conversation.type, open, requestTopics])

  if (conversation.type === "topic") return null

  function handleOpenChange(nextOpen: boolean) {
    requestVersionRef.current += 1
    if (nextOpen) {
      setTopics([])
      setNextCursor(null)
      setError("")
      setLoading(true)
    }
    setOpen(nextOpen)
  }

  function handleRetry() {
    setError("")
    setLoading(true)
    void loadTopics(undefined, false)
  }

  function handleLoadMore() {
    if (!nextCursor) return
    setError("")
    setLoadingMore(true)
    void loadTopics(nextCursor, true)
  }

  function handleTopicOpen(topicId: string) {
    handleOpenChange(false)
    onOpenTopic(topicId)
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="话题列表"
          size="icon-sm"
          title="话题列表"
          type="button"
          variant="ghost"
        >
          <MessagesSquare className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>话题</DialogTitle>
        </DialogHeader>

        <div className="min-h-40 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {loading ? (
            <TopicListStatus>
              <LoaderCircle className="size-5 animate-spin" />
              正在加载话题
            </TopicListStatus>
          ) : error && topics.length === 0 ? (
            <TopicListStatus>
              <span>{error}</span>
              <Button onClick={handleRetry} size="sm" variant="outline">
                重试
              </Button>
            </TopicListStatus>
          ) : topics.length === 0 ? (
            <TopicListStatus>
              <MessagesSquare className="size-8 opacity-50" />
              暂无话题，可从消息菜单创建话题
            </TopicListStatus>
          ) : (
            <div className="grid min-w-0 gap-1">
              {topics.map((topic) => (
                <TopicListItem
                  clientData={clientData}
                  key={topic.id}
                  onOpen={() => handleTopicOpen(topic.id)}
                  topic={topic}
                />
              ))}
              {error && (
                <div className="px-3 py-2 text-center text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {nextCursor && !loading && (
          <Button
            disabled={loadingMore}
            onClick={handleLoadMore}
            type="button"
            variant="outline"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
            加载更多
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TopicListItem({
  clientData,
  onOpen,
  topic,
}: {
  clientData: ReturnType<typeof useOptionalClientData>
  onOpen: () => void
  topic: ClientConversation
}) {
  const sourceProfile = resolveTopicSourceProfile(topic, clientData)
  const activityAt = formatActivityTime(topic.lastMessageAt || topic.createdAt)
  return (
    <button
      className="group flex w-full max-w-full min-w-0 cursor-pointer items-start gap-3 overflow-hidden rounded-md px-3 py-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onOpen}
      type="button"
    >
      <Avatar className="mt-0.5 size-8">
        <AvatarImage
          alt={sourceProfile.name}
          src={sourceProfile.avatar || undefined}
        />
        <AvatarFallback>{getAvatarInitial(sourceProfile.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{topic.name}</span>
          <TopicStatusBadges topic={topic} />
        </span>
        <span className="mt-1 block max-w-full truncate text-xs text-muted-foreground">
          {topic.lastMessageSummary || "暂无回复"}
        </span>
      </span>
      {activityAt && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {activityAt}
        </span>
      )}
    </button>
  )
}

function resolveTopicSourceProfile(
  topic: ClientConversation,
  clientData: ReturnType<typeof useOptionalClientData>
) {
  const sender = topic.topic?.sourceSender
  if (!sender) return { avatar: "", name: "话题" }
  if (sender.type === "user") {
    const profile = clientData?.getUser(sender.id)
    return {
      avatar: profile?.avatar || sender.avatar,
      name: profile?.nickname || profile?.name || sender.name || "用户",
    }
  }
  const profile = clientData?.contactApps.find((app) => app.id === sender.id)
  return {
    avatar: profile?.avatar || sender.avatar,
    name: profile?.name || sender.name || "应用",
  }
}

function TopicStatusBadges({ topic }: { topic: ClientConversation }) {
  const metadata = topic.topic
  if (!metadata) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Badge variant={metadata.archived ? "outline" : "secondary"}>
        {metadata.archived ? "已关闭" : "进行中"}
      </Badge>
      {metadata.participating && <Badge variant="outline">已参与</Badge>}
      {metadata.participating && topic.unreadCount > 0 && (
        <Badge variant="default">{topic.unreadCount} 条未读</Badge>
      )}
    </span>
  )
}

function TopicListStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function mergeTopics(
  current: ClientConversation[],
  incoming: ClientConversation[]
) {
  const existingIds = new Set(current.map((topic) => topic.id))
  return [...current, ...incoming.filter((topic) => !existingIds.has(topic.id))]
}
