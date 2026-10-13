import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
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
import { Item, ItemContent } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import { VirtualizedList } from "@/components/virtualized-list"
import type {
  DesktopContactUser,
  DesktopConversation,
  ForwardMessagesResult,
} from "../../../../shared/account-data"
import {
  mergeConversationTargetCandidates,
  filterConversationTargets,
  conversationTargetName,
  conversationTargetAvatar,
} from "../../../../shared/conversation-targets"
import { forwardToConversationTargets } from "../forward-targets"
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
  const [contacts, setContacts] = useState<DesktopContactUser[]>([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactError, setContactError] = useState("")
  const [reloadContacts, setReloadContacts] = useState(0)
  const submittingRef = useRef(false)
  const resolvedContacts = useRef(new Map<string, string>())
  const allCandidates = useMemo(
    () => mergeConversationTargetCandidates(conversations, contacts),
    [conversations, contacts],
  )
  const deferredQuery = useDeferredValue(query)
  const candidates = useMemo(
    () => filterConversationTargets(allCandidates, deferredQuery),
    [allCandidates, deferredQuery],
  )

  useEffect(() => {
    let active = true
    setLoadingContacts(true)
    setContactError("")
    void window
      .desktop!.accountData.getContacts(targetId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error.message)
        setContacts(result.data.users)
      })
      .catch((reason: unknown) => {
        if (active) setContactError(reason instanceof Error ? reason.message : "加载联系人失败")
      })
      .finally(() => {
        if (active) setLoadingContacts(false)
      })
    return () => {
      active = false
    }
  }, [targetId, reloadContacts])

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
    if (submittingRef.current || loadingContacts || !selected.size) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const targets = allCandidates.filter(
        (candidate) => selected.has(candidate.key) && !sent.has(candidate.key),
      )
      if (targets.length !== selected.size) throw new Error("部分目标已不可用，请重新选择")
      const result = await forwardToConversationTargets(
        targets,
        targetId,
        window.desktop!.accountData,
        resolvedContacts.current,
        onForward,
      )
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
      submittingRef.current = false
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
            placeholder="搜索对话或联系人"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <VirtualizedList
            items={candidates}
            getKey={(candidate) => candidate.key}
            ariaLabel="目标会话"
            resetKey={deferredQuery}
            rowHeight={38}
            loading={loadingContacts}
            empty="没有匹配的对话或联系人"
            renderItem={(candidate) => {
              const name = conversationTargetName(candidate)
              const avatar = conversationTargetAvatar(candidate)
              const checkboxId = `${id}-${candidate.key}`
              const isSent = sent.has(candidate.key)
              return (
                <Item asChild size="sm" className="cursor-pointer px-2 py-1 hover:bg-muted">
                  <Label htmlFor={checkboxId}>
                    <EntityAvatar
                      targetId={targetId}
                      type={avatar.type}
                      id={avatar.id}
                      theme={theme}
                      size={24}
                      label={`${name}头像`}
                    />
                    <ItemContent className="min-w-0 flex-1">
                      <span className="truncate text-sm">{name}</span>
                      {failures.has(candidate.key) && (
                        <span className="truncate text-xs text-destructive">
                          {failures.get(candidate.key)}
                        </span>
                      )}
                    </ItemContent>
                    {isSent ? (
                      <span className="text-xs text-muted-foreground">已转发</span>
                    ) : (
                      <Checkbox
                        id={checkboxId}
                        checked={selected.has(candidate.key)}
                        disabled={submitting}
                        onCheckedChange={() => toggle(candidate.key)}
                        aria-label={`转发到${name}`}
                      />
                    )}
                  </Label>
                </Item>
              )
            }}
          />
          {contactError && (
            <div className="flex items-center gap-2">
              <p role="alert" className="text-xs text-destructive">
                {contactError}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => setReloadContacts((value) => value + 1)}
              >
                重试
              </Button>
            </div>
          )}
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">已选择 {selected.size} 个会话</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={submitting || loadingContacts || !selected.size}>
                {submitting ? "正在转发" : `转发（${selected.size}）`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
