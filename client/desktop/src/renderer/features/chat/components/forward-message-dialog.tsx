import { useId, useMemo, useState, type FormEvent } from "react"
import { pinyin } from "pinyin-pro"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
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
import type { DesktopConversation, ForwardMessagesResult } from "../../../../shared/account-data"
import { collectForwardResults } from "../forward-retry"

export function ForwardMessageDialog({
  conversations,
  targetId,
  theme,
  messageCount,
  onForward,
  onComplete,
  onClose,
}: {
  conversations: DesktopConversation[]
  targetId: string
  theme: "light" | "dark"
  messageCount: number
  onForward: (conversationIds: string[]) => Promise<ForwardMessagesResult>
  onComplete: () => void
  onClose: () => void
}) {
  const { showToast } = useAnimatedToast()
  const id = useId()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [sent, setSent] = useState<Set<string>>(() => new Set())
  const [failures, setFailures] = useState<Map<string, string>>(() => new Map())
  const [submitting, setSubmitting] = useState(false)
  const candidates = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase().replace(/\s+/g, "")
    return conversations
      .filter((conversation) => !conversation.topic?.archived && conversation.canSend !== false)
      .filter((conversation) => {
        if (!keyword) return true
        const name = conversation.name.toLocaleLowerCase()
        const letters = pinyin(name, { type: "array", toneType: "none" })
        const full = letters.join("").toLocaleLowerCase()
        const initials = pinyin(name, { pattern: "first", type: "array", toneType: "none" })
          .join("")
          .toLocaleLowerCase()
        return name.includes(keyword) || full.includes(keyword) || initials.includes(keyword)
      })
  }, [conversations, query])

  function toggle(conversationId: string) {
    if (submitting || sent.has(conversationId)) return
    if (!selected.has(conversationId) && selected.size >= 20) {
      showToast({ status: "warning", title: "一次最多选择 20 个会话" })
      return
    }
    setSelected((current) => {
      if (!current.has(conversationId) && current.size >= 20) return current
      const next = new Set(current)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
    setFailures((current) => {
      const next = new Map(current)
      next.delete(conversationId)
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !selected.size) return
    setSubmitting(true)
    try {
      const result = await onForward([...selected])
      const { sent: succeeded, failed, retryIds } = collectForwardResults(result, sent)
      setSent(succeeded)
      setFailures(failed)
      setSelected(new Set(retryIds))
      if (!failed.size) {
        showToast({ status: "success", title: `已转发到 ${result.sentCount} 个会话` })
        onComplete()
        onClose()
      } else {
        showToast({
          status: "warning",
          title: result.sentCount
            ? `已转发到 ${result.sentCount} 个会话，${result.failedCount} 个失败`
            : "转发失败，请检查目标会话后重试",
        })
      }
    } catch (error) {
      showToast({
        status: "error",
        title: "转发消息失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{messageCount > 1 ? `转发 ${messageCount} 条消息` : "转发消息"}</DialogTitle>
          <DialogDescription>选择要转发到的会话，最多 20 个。</DialogDescription>
        </DialogHeader>
        <form className="grid min-w-0 gap-4" onSubmit={(event) => void submit(event)}>
          <Input
            aria-label="搜索目标会话"
            placeholder="搜索会话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ScrollArea
            className="h-64 rounded-md border"
            viewportClassName="[&>div]:block! [&>div]:w-full!"
          >
            <ItemGroup className="gap-1! p-2" aria-label="目标会话">
              {candidates.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的会话</p>
              )}
              {candidates.map((conversation) => {
                const checkboxId = `${id}-${conversation.id}`
                const isSent = sent.has(conversation.id)
                return (
                  <Item
                    asChild
                    key={conversation.id}
                    size="sm"
                    className="cursor-pointer px-2 py-1 hover:bg-muted"
                  >
                    <Label htmlFor={checkboxId}>
                      <EntityAvatar
                        targetId={targetId}
                        type={conversation.avatarType}
                        id={conversation.avatarId}
                        theme={theme}
                        size={24}
                        label={`${conversation.name}头像`}
                      />
                      <ItemContent className="min-w-0 flex-1">
                        <span className="truncate text-sm">{conversation.name}</span>
                        {failures.has(conversation.id) && (
                          <span className="truncate text-xs text-destructive">
                            {failures.get(conversation.id)}
                          </span>
                        )}
                      </ItemContent>
                      {isSent ? (
                        <span className="text-xs text-muted-foreground">已转发</span>
                      ) : (
                        <Checkbox
                          id={checkboxId}
                          checked={selected.has(conversation.id)}
                          disabled={submitting}
                          onCheckedChange={() => toggle(conversation.id)}
                          aria-label={`转发到${conversation.name}`}
                        />
                      )}
                    </Label>
                  </Item>
                )
              })}
            </ItemGroup>
          </ScrollArea>
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">已选择 {selected.size} 个会话</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={submitting || !selected.size}>
                {submitting ? "正在转发" : `转发（${selected.size}）`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
