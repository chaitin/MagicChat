import * as React from "react"
import { Loader2Icon, Search } from "lucide-react"
import { toast } from "sonner"

import { ConversationSelectionAvatar } from "@/components/conversation/conversation-selection-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type {
  ClientConversation,
  ClientCardSendInput,
} from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import { cn } from "@/lib/utils"

export function SendCardDialog({
  card,
  onOpenChange,
  open,
}: {
  card: ClientCardSendInput
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { conversations, sendConversationCard } = useClientData()
  const [keyword, setKeyword] = React.useState("")
  const [selectedConversationId, setSelectedConversationId] = React.useState("")
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

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && submitting) {
      return
    }
    if (!nextOpen) {
      setKeyword("")
      setSelectedConversationId("")
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedConversationId || submitting) {
      return
    }

    setSubmitting(true)
    try {
      const message = await sendConversationCard(selectedConversationId, card)
      if (!message) {
        return
      }
      const conversation = conversations.find(
        (candidate) => candidate.id === selectedConversationId
      )
      toast.success(
        conversation ? `已发送到 ${conversation.name}` : "卡片已发送"
      )
      setKeyword("")
      setSelectedConversationId("")
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-5 sm:max-w-lg"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle className="text-base">发送到对话</DialogTitle>
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
            <RadioGroup
              aria-label="目标会话"
              className="grid-cols-[minmax(0,1fr)] gap-1 p-2"
              disabled={submitting}
              onValueChange={setSelectedConversationId}
              value={selectedConversationId}
            >
              {visibleConversations.map((conversation) => {
                const selected = conversation.id === selectedConversationId
                const radioId = `card-target-${conversation.id}`

                return (
                  <Item
                    asChild
                    className={cn(
                      "min-w-0 cursor-pointer px-2 py-1.5 hover:bg-muted",
                      selected && "bg-primary/10"
                    )}
                    key={conversation.id}
                    size="sm"
                  >
                    <Label htmlFor={radioId}>
                      <ItemMedia>
                        <ConversationSelectionAvatar
                          conversation={conversation}
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full min-w-0">
                          <span className="min-w-0 truncate">
                            {conversation.name}
                          </span>
                          <Badge className="shrink-0" variant="secondary">
                            {conversationTypeLabel(conversation.type)}
                          </Badge>
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <RadioGroupItem
                          aria-label={conversation.name}
                          id={radioId}
                          value={conversation.id}
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
            </RadioGroup>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={submitting} type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button
              disabled={!selectedConversationId || submitting}
              type="submit"
            >
              {submitting && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              发送
            </Button>
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
