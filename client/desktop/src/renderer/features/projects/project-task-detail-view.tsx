import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { MoreHorizontal, Send, Trash2 } from "lucide-react"
import type {
  DesktopProjectTask,
  ProjectTaskActivity,
  ProjectTaskAssignee,
  ProjectTaskTargetInput,
  ProjectTaskUser,
} from "../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { MessageMarkdown } from "@/components/message-markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { TaskAttachmentImage } from "./task-description-editor"
import { TaskTextContextMenu } from "./task-text-context-menu"
import { taskActivityChangeText } from "./task-activity-format"
import { TaskSendDialog } from "./task-send-dialog"

const noMentionLabel = () => undefined

export function ProjectTaskDetailView({
  targetId,
  projectId,
  task,
  members,
  theme,
  onChanged,
  onEdit,
  onDelete,
  disabled,
  propertyControls,
  activityRevision,
}: {
  targetId: string
  projectId: string
  task: DesktopProjectTask
  members: ProjectTaskAssignee[]
  theme: "light" | "dark"
  onChanged: () => Promise<void>
  onEdit: () => void
  onDelete: () => void
  disabled: boolean
  propertyControls: ReactNode
  activityRevision: number
}) {
  const renderAttachment = useCallback(
    (fileId: string, alt: string) => (
      <TaskAttachmentImage
        targetId={targetId}
        projectId={projectId}
        taskId={task.id}
        fileId={fileId}
        alt={alt}
      />
    ),
    [targetId, projectId, task.id],
  )
  const labels = task.labels.filter((label) => label.trim())
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const userName = (user: ProjectTaskUser) => {
    const memberName = members.find((member) => member.id === user.id)?.displayName.trim()
    return (
      (memberName && memberName !== user.id ? memberName : "") ||
      user.nickname ||
      user.name ||
      user.id
    )
  }
  return (
    <>
      {task.title.trim() && (
        <div className="col-span-1 row-start-1 flex min-w-0 items-center justify-between gap-3 border-b pb-2 md:col-span-2">
          <TaskTextContextMenu>
            <h1 className="min-w-0 break-words text-xl font-semibold select-text">{task.title}</h1>
          </TaskTextContextMenu>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onEdit}>
              修改
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label="更多操作"
                  title="更多操作"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => requestAnimationFrame(() => setSendDialogOpen(true))}
                >
                  <Send />
                  发送到对话
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      <div className="grid min-w-0 content-start gap-5 md:col-start-1 md:row-start-2">
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="标签">
            {labels.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="max-w-full border-sky-300 bg-sky-100 text-sky-600 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-400 whitespace-normal break-words"
              >
                {label}
              </Badge>
            ))}
          </div>
        )}
        {task.description.trim() ? (
          <TaskTextContextMenu>
            <div className="min-w-0 text-sm select-text" role="region" aria-label="详细说明内容">
              <MessageMarkdown
                content={task.description}
                currentUserId=""
                mentionLabelResolver={noMentionLabel}
                renderAttachmentImage={renderAttachment}
              />
            </div>
          </TaskTextContextMenu>
        ) : (
          <p className="text-sm text-muted-foreground">暂无详细说明</p>
        )}
        <TaskActivitySection
          targetId={targetId}
          projectId={projectId}
          taskId={task.id}
          members={members}
          onChanged={onChanged}
          revision={activityRevision}
        />
      </div>
      <div className="grid min-w-0 content-start gap-3 md:col-start-2 md:row-start-2">
        {propertyControls}
        <ReadOnlyField label="创建人">
          <TaskUser
            targetId={targetId}
            user={task.creator}
            name={userName(task.creator)}
            theme={theme}
          />
        </ReadOnlyField>
        <ReadOnlyField label="创建时间">
          <time dateTime={task.createdAt}>{displayMinute(task.createdAt)}</time>
        </ReadOnlyField>
        <ReadOnlyField label="更新时间">
          <time dateTime={task.updatedAt}>{displayMinute(task.updatedAt)}</time>
        </ReadOnlyField>
      </div>
      <TaskSendDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        targetId={targetId}
        task={task}
        theme={theme}
      />
    </>
  )
}

function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid min-w-0 gap-1 text-sm">
      <h2 className="text-xs font-normal text-muted-foreground">{label}</h2>
      <div className="flex min-h-9 min-w-0 items-center rounded-md border border-input bg-background px-3 py-2">
        {children}
      </div>
    </section>
  )
}

function TaskUser({
  targetId,
  user,
  name,
  theme,
}: {
  targetId: string
  user: ProjectTaskUser
  name?: string
  theme: "light" | "dark"
}) {
  const label = name || user.nickname || user.name || user.id
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EntityAvatar
        targetId={targetId}
        type="user"
        id={user.id}
        theme={theme}
        size={20}
        label={`${label}头像`}
      />
      <span className="break-words">{label}</span>
    </span>
  )
}

function displayTime(value: string) {
  return new Date(value).toLocaleString("zh-CN")
}

function displayMinute(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function TaskActivitySection({
  targetId,
  projectId,
  taskId,
  members,
  onChanged,
  revision,
}: ProjectTaskTargetInput & {
  revision: number
  members: ProjectTaskAssignee[]
  onChanged: () => Promise<void>
}) {
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [comment, setComment] = useState("")
  const [commenting, setCommenting] = useState(false)
  const userNames = new Map(
    members
      .filter((member) => member.displayName && member.displayName !== member.id)
      .map((member) => [member.id, member.displayName]),
  )
  const active = useRef(false)
  const loadingRef = useRef(false)

  useEffect(() => {
    active.current = true
    let cancelled = false
    loadingRef.current = true
    setLoading(true)
    setError("")
    void window
      .taskWindow!.accountData.listProjectTaskActivities({ targetId, projectId, taskId })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error.message)
        setActivities(result.data.items)
        setCursor(result.data.nextCursor)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载任务动态失败")
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          loadingRef.current = false
        }
      })
    return () => {
      cancelled = true
      active.current = false
    }
  }, [targetId, projectId, taskId, reload, revision])

  async function loadMore() {
    if (!cursor || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError("")
    try {
      const result = await window.taskWindow!.accountData.listProjectTaskActivities({
        targetId,
        projectId,
        taskId,
        cursor,
      })
      if (!active.current) return
      if (!result.ok) throw new Error(result.error.message)
      if (result.data.nextCursor === cursor) throw new Error("任务动态分页格式不正确")
      setActivities((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...result.data.items.filter((item) => !seen.has(item.id))]
      })
      setCursor(result.data.nextCursor)
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "加载任务动态失败")
    } finally {
      if (active.current) {
        setLoading(false)
        loadingRef.current = false
      }
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (commenting || !comment.trim()) return
    setCommenting(true)
    setError("")
    try {
      const result = await window.taskWindow!.accountData.addProjectTaskComment({
        targetId,
        projectId,
        taskId,
        content: comment.trim(),
      })
      if (!active.current) return
      if (!result.ok) throw new Error(result.error.message)
      setComment("")
      setReload((value) => value + 1)
      await onChanged()
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "添加评论失败")
    } finally {
      if (active.current) setCommenting(false)
    }
  }

  return (
    <section aria-label="任务动态" className="grid min-w-0 gap-3 border-t pt-4">
      {!activities.length && !loading && !error && (
        <p className="text-xs text-muted-foreground">暂无动态</p>
      )}
      <div className="grid gap-2">
        {activities.map((activity) => (
          <article key={activity.id} className="min-w-0 rounded-md bg-muted/50 px-3 py-2 text-xs">
            <span className="font-medium">
              {members.find((member) => member.id === activity.actor.id)?.displayName ||
                activity.actor.nickname ||
                activity.actor.name ||
                activity.actor.id}
            </span>
            <time dateTime={activity.createdAt} className="ml-2 text-muted-foreground">
              {displayTime(activity.createdAt)}
            </time>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {activity.type === "commented"
                ? activity.content
                : activity.type === "created"
                  ? "创建了任务"
                  : activity.changes.length
                    ? activity.changes
                        .map((change) => taskActivityChangeText(change, userNames))
                        .join("；")
                    : "更新了任务"}
            </p>
          </article>
        ))}
      </div>
      {loading && <p className="text-xs text-muted-foreground">加载动态中…</p>}
      {error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => (cursor ? void loadMore() : setReload((value) => value + 1))}
          >
            重试
          </Button>
        </div>
      )}
      {cursor && !error && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? "加载中…" : "加载更多动态"}
        </Button>
      )}
      <form onSubmit={(event) => void addComment(event)}>
        <InputGroup data-disabled={commenting} aria-label="评论输入框">
          <InputGroupTextarea
            aria-label="评论内容"
            placeholder="添加评论"
            value={comment}
            disabled={commenting}
            maxLength={10000}
            rows={1}
            className="min-h-10"
            onChange={(event) => setComment(event.target.value)}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={commenting || !comment.trim()}
            >
              {commenting ? "发送中…" : "发送"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </section>
  )
}
