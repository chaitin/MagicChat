import * as React from "react"
import { Loader2Icon, Search } from "lucide-react"
import { toast } from "sonner"

import type {
  ClientConversation,
  ForwardConversationMessagesResult,
} from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"
import { cn } from "@/lib/utils"
import { ConversationSelectionAvatar } from "@/components/conversation/conversation-selection-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"

const maxForwardTargets = 20

export function ForwardMessageDialog({
  conversations,
  messageCount,
  onComplete,
  onForward,
  onOpenChange,
  open,
}: {
  conversations: ClientConversation[]
  messageCount: number
  onComplete: () => void
  onForward: (
    targetConversationIds: string[]
  ) => Promise<ForwardConversationMessagesResult>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [failedByConversationId, setFailedByConversationId] = React.useState<
    Map<string, string>
  >(() => new Map())
  const [keyword, setKeyword] = React.useState("")
  const [selectedConversationIds, setSelectedConversationIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [sentConversationIds, setSentConversationIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [submitting, setSubmitting] = React.useState(false)

  const visibleConversations = React.useMemo(() => {
    const sendableConversations = conversations.filter(
      (conversation) => !conversation.topic?.archived
    )
    const normalizedKeyword = keyword.trim().toLocaleLowerCase()
    if (!normalizedKeyword) {
      return sendableConversations
    }

    return sendableConversations.filter((conversation) =>
      conversation.name.toLocaleLowerCase().includes(normalizedKeyword)
    )
  }, [conversations, keyword])

  function toggleConversation(conversationId: string, checked: boolean) {
    if (submitting || sentConversationIds.has(conversationId)) {
      return
    }
    setSelectedConversationIds((current) => {
      const next = new Set(current)
      if (checked) {
        if (next.size >= maxForwardTargets) {
          toast.warning(`一次最多选择 ${maxForwardTargets} 个会话`)
          return current
        }
        next.add(conversationId)
      } else {
        next.delete(conversationId)
      }
      return next
    })
    setFailedByConversationId((current) => {
      if (!current.has(conversationId)) {
        return current
      }
      const next = new Map(current)
      next.delete(conversationId)
      return next
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && submitting) {
      return
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || selectedConversationIds.size === 0) {
      return
    }

    setSubmitting(true)
    try {
      const result = await onForward(Array.from(selectedConversationIds))
      const failed = new Map<string, string>()
      const sent = new Set(sentConversationIds)
      for (const target of result.results) {
        if (target.status === "sent") {
          sent.add(target.conversationId)
        } else {
          failed.set(target.conversationId, target.error?.message ?? "转发失败")
        }
      }

      setSentConversationIds(sent)
      setFailedByConversationId(failed)
      setSelectedConversationIds(new Set(failed.keys()))

      if (result.failedCount === 0) {
        toast.success(`已转发到 ${result.sentCount} 个会话`)
        onComplete()
        onOpenChange(false)
      } else if (result.sentCount > 0) {
        toast.warning(
          `已转发到 ${result.sentCount} 个会话，${result.failedCount} 个失败`
        )
      } else {
        toast.error("转发失败，请检查目标会话后重试")
      }
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "转发消息失败"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-5 sm:max-w-lg"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle className="text-base">
            {messageCount > 1 ? `转发 ${messageCount} 条消息` : "转发消息"}
          </DialogTitle>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索会话"
              className="pl-8"
              disabled={submitting}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索会话"
              type="search"
              value={keyword}
            />
          </div>

          <div className="h-80 overflow-y-auto rounded-md border">
            <ItemGroup
              aria-label="转发目标会话"
              className="gap-1 p-2 has-data-[size=sm]:gap-1"
            >
              {visibleConversations.map((conversation) => {
                const checked = selectedConversationIds.has(conversation.id)
                const sent = sentConversationIds.has(conversation.id)
                const error = failedByConversationId.get(conversation.id)
                const checkboxId = `forward-target-${conversation.id}`

                return (
                  <Item
                    asChild
                    className={cn(
                      "px-2 py-1.5",
                      sent
                        ? "cursor-default opacity-60"
                        : "cursor-pointer hover:bg-muted",
                      checked && "bg-primary/10"
                    )}
                    key={conversation.id}
                    size="sm"
                  >
                    <Label htmlFor={checkboxId}>
                      <ItemMedia>
                        <ConversationSelectionAvatar
                          conversation={conversation}
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full">
                          <span className="truncate">{conversation.name}</span>
                          <Badge className="shrink-0" variant="secondary">
                            {conversationTypeLabel(conversation.type)}
                          </Badge>
                        </ItemTitle>
                        {(error || sent) && (
                          <ItemDescription
                            className={cn(error && "text-destructive")}
                          >
                            {error ?? "已转发"}
                          </ItemDescription>
                        )}
                      </ItemContent>
                      <ItemActions>
                        <Checkbox
                          aria-label={conversation.name}
                          checked={sent || checked}
                          disabled={submitting || sent}
                          id={checkboxId}
                          onCheckedChange={(value) =>
                            toggleConversation(conversation.id, value === true)
                          }
                        />
                      </ItemActions>
                    </Label>
                  </Item>
                )
              })}
              {visibleConversations.length === 0 && (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  没有匹配的会话
                </div>
              )}
            </ItemGroup>
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              已选择 {selectedConversationIds.size} 个会话
            </span>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button disabled={submitting} type="button" variant="outline">
                  取消
                </Button>
              </DialogClose>
              <Button
                disabled={submitting || selectedConversationIds.size === 0}
                type="submit"
              >
                {submitting && (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                )}
                转发
                {selectedConversationIds.size > 0
                  ? `（${selectedConversationIds.size}）`
                  : ""}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function conversationTypeLabel(type: ClientConversation["type"]) {
  switch (type) {
    case "group":
      return "群聊"
    case "app":
      return "Agent"
    default:
      return "私聊"
  }
}
