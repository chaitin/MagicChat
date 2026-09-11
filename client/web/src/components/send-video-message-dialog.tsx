import * as React from "react"
import { LoaderCircle } from "lucide-react"

import { MentionCandidateMenu } from "@/components/conversation/mention-candidate-menu"
import {
  createDraftMentionTemplate,
  filterMentionCandidates,
  getMentionTrigger,
  getVisibleMentionIndex,
  insertDraftMention,
  isImeCompositionKeyEvent,
  syncDraftMentions,
  type MentionCandidate,
  type MentionTrigger,
} from "@/lib/conversation-composer"
import type { ConversationDraftMention } from "@/lib/conversation-drafts"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const emptyMentionCandidates: MentionCandidate[] = []

type CaptionMentionState = {
  mentions: ConversationDraftMention[]
  selectedIndex: number
  trigger: MentionTrigger | null
  video: File | null
}

export function SendVideoMessageDialog({
  caption,
  conversationName,
  mentionCandidates = emptyMentionCandidates,
  onCaptionChange,
  onConfirm,
  onOpenChange,
  open,
  sending,
  video,
}: {
  caption: string
  conversationName: string
  mentionCandidates?: MentionCandidate[]
  onCaptionChange: (caption: string) => void
  onConfirm: (caption: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  sending: boolean
  video: File | null
}) {
  const previewURL = useObjectURL(video)
  const captionInputRef = React.useRef<HTMLInputElement | null>(null)
  const [mentionState, setMentionState] = React.useState<CaptionMentionState>({
    mentions: [],
    selectedIndex: 0,
    trigger: null,
    video: null,
  })
  const mentions = mentionState.video === video ? mentionState.mentions : []
  const trigger = mentionState.video === video ? mentionState.trigger : null
  const selectedIndex =
    mentionState.video === video ? mentionState.selectedIndex : 0
  const candidates = React.useMemo(
    () => filterMentionCandidates(mentionCandidates, trigger?.query ?? ""),
    [mentionCandidates, trigger?.query]
  )

  function handleCaptionChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextCaption = event.target.value
    const cursor = event.target.selectionStart ?? nextCaption.length
    setMentionState({
      mentions: syncDraftMentions(mentions, caption, nextCaption),
      selectedIndex: 0,
      trigger:
        mentionCandidates.length > 0
          ? getMentionTrigger(nextCaption, cursor)
          : null,
      video,
    })
    onCaptionChange(nextCaption)
  }

  function insertMention(candidate: MentionCandidate | undefined) {
    if (!candidate) return
    const input = captionInputRef.current
    const selectionEnd = input?.selectionStart ?? caption.length
    const currentTrigger = getMentionTrigger(caption, selectionEnd)
    const inserted = insertDraftMention(
      caption,
      mentions,
      candidate,
      currentTrigger?.start ?? selectionEnd,
      selectionEnd
    )
    setMentionState({
      mentions: inserted.mentions,
      selectedIndex: 0,
      trigger: null,
      video,
    })
    onCaptionChange(inserted.value)
    window.requestAnimationFrame(() => {
      captionInputRef.current?.focus()
      captionInputRef.current?.setSelectionRange(
        inserted.cursor,
        inserted.cursor
      )
    })
  }

  function handleCaptionKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (isImeCompositionKeyEvent(event)) return
    if (trigger && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const offset = event.key === "ArrowDown" ? 1 : -1
        setMentionState((current) => ({
          ...current,
          selectedIndex:
            (selectedIndex + offset + candidates.length) % candidates.length,
          video,
        }))
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        insertMention(
          candidates[getVisibleMentionIndex(selectedIndex, candidates.length)]
        )
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionState((current) => ({
          ...current,
          selectedIndex: 0,
          trigger: null,
          video,
        }))
        return
      }
    }
    if (event.key === "Enter" && video && !sending) {
      event.preventDefault()
      submit()
    }
  }

  function submit() {
    onConfirm(createDraftMentionTemplate(caption, mentions))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(42rem,90vw)] gap-5 overflow-hidden"
        onOpenAutoFocus={(event) => {
          if (!video || sending) return
          event.preventDefault()
          captionInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">发送视频</DialogTitle>
          <DialogDescription className="sr-only">
            确认发送视频到当前会话
          </DialogDescription>
        </DialogHeader>
        {video && (
          <div className="grid min-h-0 gap-3">
            {previewURL && (
              <video
                className="max-h-[52vh] w-full rounded-md bg-black object-contain"
                controls
                playsInline
                preload="metadata"
                src={previewURL}
              />
            )}
            <p className="min-w-0 text-sm text-muted-foreground">
              将要发送到{" "}
              <span className="font-medium text-foreground">
                {conversationName}
              </span>
            </p>
            <div className="relative">
              <Input
                ref={captionInputRef}
                aria-label="视频说明"
                disabled={sending}
                maxLength={5000}
                onChange={handleCaptionChange}
                onKeyDown={handleCaptionKeyDown}
                onSelect={(event) => {
                  const input = event.currentTarget
                  setMentionState((current) => ({
                    mentions: current.video === video ? current.mentions : [],
                    selectedIndex: 0,
                    trigger:
                      mentionCandidates.length > 0
                        ? getMentionTrigger(
                            input.value,
                            input.selectionStart ?? input.value.length
                          )
                        : null,
                    video,
                  }))
                }}
                placeholder="添加视频说明"
                value={caption}
              />
              {trigger && candidates.length > 0 && (
                <MentionCandidateMenu
                  candidates={candidates}
                  onSelect={insertMention}
                  selectedIndex={selectedIndex}
                />
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={sending} type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button disabled={!video || sending} onClick={submit} type="button">
            {sending && <LoaderCircle className="size-4 animate-spin" />}
            发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useObjectURL(file: File | null) {
  const [source, setSource] = React.useState<{
    file: File | null
    url: string | null
  } | null>(null)

  React.useEffect(() => {
    let active = true
    if (!file) {
      queueMicrotask(() => {
        if (active) setSource({ file: null, url: null })
      })
      return () => {
        active = false
      }
    }
    const objectURL = URL.createObjectURL(file)
    queueMicrotask(() => {
      if (active) setSource({ file, url: objectURL })
    })
    return () => {
      active = false
      URL.revokeObjectURL(objectURL)
    }
  }, [file])

  return source?.file === file ? source.url : null
}
