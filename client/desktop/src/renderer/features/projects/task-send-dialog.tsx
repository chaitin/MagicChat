import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import type {
  DesktopContactUser,
  DesktopConversation,
  DesktopProjectTask,
} from "../../../shared/account-data"
import {
  mergeConversationTargetCandidates,
  filterConversationTargets,
  conversationTargetName,
  conversationTargetAvatar,
  resolveConversationTarget,
} from "../../../shared/conversation-targets"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { VirtualizedList } from "@/components/virtualized-list"

export function TaskSendDialog({
  open,
  onOpenChange,
  targetId,
  task,
  theme,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetId: string
  task: DesktopProjectTask
  theme: "light" | "dark"
}) {
  const { showToast } = useAnimatedToast()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState("")
  const [conversations, setConversations] = useState<DesktopConversation[]>([])
  const [contacts, setContacts] = useState<DesktopContactUser[]>([])
  const [loadError, setLoadError] = useState("")
  const [reload, setReload] = useState(0)
  const submittingRef = useRef(false)
  const resolvedContacts = useRef(new Map<string, string>())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const candidates = useMemo(
    () => mergeConversationTargetCandidates(conversations, contacts),
    [conversations, contacts],
  )
  const deferredQuery = useDeferredValue(query)
  const visible = useMemo(
    () => filterConversationTargets(candidates, deferredQuery),
    [candidates, deferredQuery],
  )

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setLoadError("")
    setQuery("")
    setSelected("")
    setConversations([])
    setContacts([])
    resolvedContacts.current.clear()
    void Promise.all([
      window.taskWindow!.accountData.listConversations({ targetId, selectedConversationId: null }),
      window.taskWindow!.accountData.getContacts(targetId),
    ])
      .then(([result, directory]) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        if (!directory.ok) throw new Error(directory.error.message)
        setConversations(result.data)
        setContacts(directory.data.users)
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadError(reason instanceof Error ? reason.message : "加载候选失败")
          showToast({
            status: "error",
            title: "加载对话和联系人失败",
            description: reason instanceof Error ? reason.message : "请稍后重试",
          })
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, targetId, showToast, reload])

  async function send() {
    const candidate = candidates.find((item) => item.key === selected)
    if (!candidate || loading || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const conversationId = await resolveConversationTarget(
        candidate,
        targetId,
        window.taskWindow!.accountData,
        resolvedContacts.current,
      )
      const result = await window.taskWindow!.accountData.sendRichMessage({
        targetId,
        conversationId,
        body: { type: "entity_card", entityType: "task", entityId: task.id },
      })
      if (!result.ok) throw new Error(result.error.message)
      showToast({
        status: "success",
        title: `已发送到 ${conversationTargetName(candidate)}`,
      })
      onOpenChange(false)
    } catch (reason) {
      showToast({
        status: "error",
        title: "发送任务失败",
        description: reason instanceof Error ? reason.message : "请稍后重试",
      })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onOpenChange(false)
      }}
    >
      <DialogContent className="gap-5 sm:max-w-lg" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle className="text-base">发送到对话</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            aria-label="搜索会话"
            placeholder="搜索对话或联系人"
            type="search"
            value={query}
            disabled={loading || submitting}
            onChange={(event) => setQuery(event.target.value)}
          />
          <RadioGroup
            aria-label="目标会话"
            value={selected}
            disabled={loading || submitting}
            onValueChange={setSelected}
            className="grid-cols-[minmax(0,1fr)] gap-1 p-2"
          >
            <VirtualizedList
              items={visible}
              getKey={(candidate) => candidate.key}
              ariaLabel="目标会话"
              resetKey={deferredQuery}
              loading={loading}
              empty="没有匹配的对话或联系人"
              renderItem={(candidate) => {
                const name = conversationTargetName(candidate)
                const avatar = conversationTargetAvatar(candidate)
                const id = `task-send-${candidate.key}`
                return (
                  <Item
                    asChild
                    size="sm"
                    className="min-w-0 cursor-pointer px-2 py-1.5 hover:bg-muted"
                  >
                    <Label htmlFor={id}>
                      <ItemMedia>
                        <EntityAvatar
                          targetId={targetId}
                          type={avatar.type}
                          id={avatar.id}
                          theme={theme}
                          size={24}
                          label={`${name}头像`}
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full min-w-0">
                          <span className="truncate">{name}</span>
                        </ItemTitle>
                      </ItemContent>
                      <RadioGroupItem id={id} value={candidate.key} aria-label={name} />
                    </Label>
                  </Item>
                )
              }}
            />
          </RadioGroup>
          {loadError && (
            <div className="flex items-center gap-2">
              <p role="alert" className="text-xs text-destructive">
                {loadError}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReload((value) => value + 1)}
              >
                重试
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!selected || loading || submitting}
            onClick={() => void send()}
          >
            {submitting ? "发送中…" : "发送"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
