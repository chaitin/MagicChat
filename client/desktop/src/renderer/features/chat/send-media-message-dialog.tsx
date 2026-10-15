import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { Input as BeInput } from "@/components/motion/input"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { MentionCandidateMenu } from "./components/mention-candidate-menu"
import {
  createDraftMentionTemplate,
  filterMentionCandidates,
  getMentionTrigger,
  insertDraftMention,
  syncDraftMentions,
  type DraftMention,
  type MentionCandidate,
} from "./conversation-mentions"

export function SendMediaMessageDialog({
  targetId,
  resolvedTheme,
  mentionCandidates,
  category,
  caption,
  conversationName,
  open,
  resourceUrl,
  sending,
  onCaptionChange,
  onConfirm,
  onOpenChange,
}: {
  targetId: string
  resolvedTheme: "light" | "dark"
  mentionCandidates: MentionCandidate[]
  category: "image" | "video"
  caption: string
  conversationName: string
  open: boolean
  resourceUrl: string
  sending: boolean
  onCaptionChange: (caption: string) => void
  onConfirm: (caption: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const captionInputRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const [captionMentions, setCaptionMentions] = useState<DraftMention[]>([])
  const [mentionTrigger, setMentionTrigger] = useState<ReturnType<typeof getMentionTrigger>>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const filteredCandidates = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionTrigger?.query ?? ""),
    [mentionCandidates, mentionTrigger?.query],
  )
  const mentionMenuOpen = Boolean(open && !sending && mentionTrigger && filteredCandidates.length)
  const label = category === "image" ? "图片" : "视频"

  useEffect(() => {
    setCaptionMentions([])
    setMentionTrigger(null)
    setSelectedMentionIndex(0)
  }, [open, resourceUrl])

  function updateMentionTrigger(value: string, cursor: number) {
    setMentionTrigger(
      !sending && mentionCandidates.length ? getMentionTrigger(value, cursor) : null,
    )
    setSelectedMentionIndex(0)
  }

  function changeCaption(value: string) {
    setCaptionMentions((current) => syncDraftMentions(current, caption, value))
    onCaptionChange(value)
    updateMentionTrigger(value, captionInputRef.current?.selectionStart ?? value.length)
  }

  function insertCandidate(candidate: MentionCandidate) {
    if (sending) return
    const cursor = captionInputRef.current?.selectionStart ?? caption.length
    const trigger = getMentionTrigger(caption, cursor)
    if (!trigger) return
    const inserted = insertDraftMention(caption, captionMentions, candidate, trigger.start, cursor)
    if (inserted.value.length > 5000) return
    onCaptionChange(inserted.value)
    setCaptionMentions(inserted.mentions)
    setMentionTrigger(null)
    setSelectedMentionIndex(0)
    requestAnimationFrame(() => {
      const input = captionInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  function confirm() {
    if (!sending && resourceUrl) onConfirm(createDraftMentionTemplate(caption, captionMentions))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || sending) return
    if (mentionTrigger && event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setMentionTrigger(null)
      return
    }
    if (mentionTrigger && filteredCandidates.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedMentionIndex(
          (current) =>
            (current + (event.key === "ArrowDown" ? 1 : -1) + filteredCandidates.length) %
            filteredCandidates.length,
        )
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        event.stopPropagation()
        insertCandidate(
          filteredCandidates[Math.min(selectedMentionIndex, filteredCandidates.length - 1)],
        )
        return
      }
    }
    if (event.key === "Enter") {
      event.preventDefault()
      confirm()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "gap-5 overflow-hidden",
          category === "image"
            ? "h-[60vh] w-[60vw] max-w-[60vw] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[60vw]"
            : "w-[min(42rem,90vw)]",
        )}
        onOpenAutoFocus={(event) => {
          if (!resourceUrl || sending) return
          event.preventDefault()
          captionInputRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (!mentionTrigger) return
          event.preventDefault()
          setMentionTrigger(null)
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">发送{label}</DialogTitle>
          <DialogDescription className="sr-only">确认发送{label}到当前会话</DialogDescription>
        </DialogHeader>
        {resourceUrl && (
          <div
            className={cn(
              "grid min-h-0 gap-3",
              category === "image" && "grid-rows-[minmax(0,1fr)_auto_auto]",
            )}
          >
            {category === "image" ? (
              <div className="relative min-h-0 overflow-hidden rounded-md border bg-muted/20">
                <img
                  src={resourceUrl}
                  alt="待发送图片预览"
                  className="absolute inset-0 size-full object-contain"
                  draggable={false}
                />
              </div>
            ) : (
              <video
                src={resourceUrl}
                className="max-h-[52vh] w-full rounded-md bg-black object-contain"
                controls
                playsInline
                preload="metadata"
              />
            )}
            <p className="min-w-0 text-sm text-muted-foreground">
              将要发送到 <span className="font-medium text-foreground">{conversationName}</span>
            </p>
            <Popover
              open={mentionMenuOpen}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setMentionTrigger(null)
              }}
            >
              <PopoverAnchor asChild>
                <div>
                  <BeInput
                    ref={captionInputRef}
                    aria-label={`${label}说明`}
                    role="combobox"
                    aria-expanded={mentionMenuOpen}
                    aria-controls={mentionMenuOpen ? menuId : undefined}
                    aria-autocomplete="list"
                    disabled={sending}
                    maxLength={5000}
                    placeholder={`添加${label}说明`}
                    value={caption}
                    onChange={changeCaption}
                    onSelect={(event) =>
                      updateMentionTrigger(
                        event.currentTarget.value,
                        event.currentTarget.selectionStart ?? 0,
                      )
                    }
                    onBlur={() => setMentionTrigger(null)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-72 bg-transparent p-0 shadow-none ring-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => {
                  if (event.target === captionInputRef.current) event.preventDefault()
                }}
              >
                <MentionCandidateMenu
                  id={menuId}
                  candidates={filteredCandidates}
                  selectedIndex={Math.min(selectedMentionIndex, filteredCandidates.length - 1)}
                  targetId={targetId}
                  theme={resolvedTheme}
                  onSelect={insertCandidate}
                  className="static mb-0 w-full"
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <BeButton type="button" variant="outline" disabled={sending}>
              取消
            </BeButton>
          </DialogClose>
          <BeButton type="button" disabled={!resourceUrl || sending} onClick={confirm}>
            {sending && <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />}
            发送
          </BeButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
