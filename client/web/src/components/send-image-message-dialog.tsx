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
import { cn } from "@/lib/utils"
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

type SendImageMessageDialogProps = {
  caption: string
  conversationName: string
  image: File | null
  mentionCandidates?: MentionCandidate[]
  onCaptionChange: (caption: string) => void
  onConfirm: (caption: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  sending: boolean
}

type PreviewOffset = {
  x: number
  y: number
}

type PreviewSize = {
  height: number
  width: number
}

const minImagePreviewZoom = 0.5
const maxImagePreviewZoom = 3
const imagePreviewZoomStep = 0.1
const emptyMentionCandidates: MentionCandidate[] = []

type CaptionMentionState = {
  image: File | null
  mentions: ConversationDraftMention[]
  selectedIndex: number
  trigger: MentionTrigger | null
}

export function SendImageMessageDialog({
  caption,
  conversationName,
  image,
  mentionCandidates = emptyMentionCandidates,
  onCaptionChange,
  onConfirm,
  onOpenChange,
  open,
  sending,
}: SendImageMessageDialogProps) {
  const previewURL = useObjectURL(image)
  const captionInputRef = React.useRef<HTMLInputElement | null>(null)
  const previewDragRef = React.useRef<{
    imageKey: string
    offset: PreviewOffset
    pointerId: number
    x: number
    y: number
  } | null>(null)
  const imageKey = previewURL ?? ""
  const [previewAreaElement, setPreviewAreaElement] =
    React.useState<HTMLDivElement | null>(null)
  const [previewAreaSize, setPreviewAreaSize] =
    React.useState<PreviewSize | null>(null)
  const [zoomState, setZoomState] = React.useState({
    imageKey: "",
    value: 1,
  })
  const [imageSize, setImageSize] = React.useState<{
    height: number
    imageKey: string
    width: number
  } | null>(null)
  const [previewOffset, setPreviewOffset] = React.useState<PreviewOffset>({
    x: 0,
    y: 0,
  })
  const [previewDragging, setPreviewDragging] = React.useState(false)
  const [captionMentionState, setCaptionMentionState] =
    React.useState<CaptionMentionState>({
      image: null,
      mentions: [],
      selectedIndex: 0,
      trigger: null,
    })
  const captionMentions =
    captionMentionState.image === image ? captionMentionState.mentions : []
  const captionMentionTrigger =
    captionMentionState.image === image ? captionMentionState.trigger : null
  const selectedMentionIndex =
    captionMentionState.image === image ? captionMentionState.selectedIndex : 0
  const filteredMentionCandidates = React.useMemo(
    () =>
      filterMentionCandidates(
        mentionCandidates,
        captionMentionTrigger?.query ?? ""
      ),
    [captionMentionTrigger?.query, mentionCandidates]
  )
  const zoom = zoomState.imageKey === imageKey ? zoomState.value : 1
  const currentImageSize = imageSize?.imageKey === imageKey ? imageSize : null
  const previewSize =
    currentImageSize && previewAreaSize
      ? getContainedSize(
          currentImageSize,
          previewAreaSize.width,
          previewAreaSize.height
        )
      : null
  const clampedPreviewOffset =
    previewAreaSize && previewSize
      ? clampPreviewOffset(previewOffset, previewAreaSize, previewSize, zoom)
      : { x: 0, y: 0 }

  const handlePreviewWheel = React.useCallback(
    (event: WheelEvent) => {
      if (!image || event.deltaY === 0) {
        return
      }

      event.preventDefault()
      const nextZoom = clampPreviewZoom(
        zoom + (event.deltaY < 0 ? imagePreviewZoomStep : -imagePreviewZoomStep)
      )

      setZoomState({ imageKey, value: nextZoom })
      setPreviewOffset((currentOffset) => {
        return previewAreaSize && previewSize
          ? clampPreviewOffset(
              currentOffset,
              previewAreaSize,
              previewSize,
              nextZoom
            )
          : { x: 0, y: 0 }
      })
    },
    [image, imageKey, previewAreaSize, previewSize, zoom]
  )

  React.useEffect(() => {
    if (!open || !previewAreaElement) {
      return
    }

    const updatePreviewAreaSize = () => {
      setPreviewAreaSize({
        height: previewAreaElement.clientHeight,
        width: previewAreaElement.clientWidth,
      })
    }

    updatePreviewAreaSize()

    const resizeObserver = new ResizeObserver(updatePreviewAreaSize)
    resizeObserver.observe(previewAreaElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [open, previewAreaElement])

  React.useEffect(() => {
    if (!open || !image || !previewURL || !previewAreaElement) {
      return
    }

    previewAreaElement.addEventListener("wheel", handlePreviewWheel, {
      passive: false,
    })

    return () => {
      previewAreaElement.removeEventListener("wheel", handlePreviewWheel)
    }
  }, [handlePreviewWheel, image, open, previewAreaElement, previewURL])

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !previewAreaSize || !previewSize || zoom <= 1) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewDragRef.current = {
      imageKey,
      offset: clampedPreviewOffset,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    setPreviewDragging(true)
  }

  function handlePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previewDrag = previewDragRef.current

    if (
      !previewDrag ||
      previewDrag.imageKey !== imageKey ||
      previewDrag.pointerId !== event.pointerId ||
      !previewAreaSize ||
      !previewSize
    ) {
      return
    }

    setPreviewOffset(
      clampPreviewOffset(
        {
          x: previewDrag.offset.x + event.clientX - previewDrag.x,
          y: previewDrag.offset.y + event.clientY - previewDrag.y,
        },
        previewAreaSize,
        previewSize,
        zoom
      )
    )
  }

  function handlePreviewPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (
      previewDragRef.current?.imageKey !== imageKey ||
      previewDragRef.current.pointerId !== event.pointerId
    ) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    previewDragRef.current = null
    setPreviewDragging(false)
  }

  function handleCaptionChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextCaption = event.target.value
    const cursor = event.target.selectionStart ?? nextCaption.length

    setCaptionMentionState({
      image,
      mentions: syncDraftMentions(captionMentions, caption, nextCaption),
      selectedIndex: 0,
      trigger:
        mentionCandidates.length > 0
          ? getMentionTrigger(nextCaption, cursor)
          : null,
    })
    onCaptionChange(nextCaption)
  }

  function handleCaptionSelect(event: React.SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const value = input.value
    const cursor = input.selectionStart ?? value.length

    setCaptionMentionState((currentState) => ({
      image,
      mentions: currentState.image === image ? currentState.mentions : [],
      selectedIndex: 0,
      trigger:
        mentionCandidates.length > 0 ? getMentionTrigger(value, cursor) : null,
    }))
  }

  function handleCaptionKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (isImeCompositionKeyEvent(event)) {
      return
    }

    if (captionMentionTrigger && filteredMentionCandidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedMentionIndex(
          (selectedMentionIndex + 1) % filteredMentionCandidates.length
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedMentionIndex(
          (selectedMentionIndex - 1 + filteredMentionCandidates.length) %
            filteredMentionCandidates.length
        )
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        closeMentionCandidates()
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        insertCaptionMention(
          filteredMentionCandidates[
            getVisibleMentionIndex(
              selectedMentionIndex,
              filteredMentionCandidates.length
            )
          ] ?? filteredMentionCandidates[0]
        )
        return
      }
    }

    if (event.key === "Enter" && image && !sending) {
      event.preventDefault()
      submitCaption()
    }
  }

  function insertCaptionMention(candidate: MentionCandidate | undefined) {
    if (!candidate) {
      return
    }

    const input = captionInputRef.current
    const selectionEnd = input?.selectionStart ?? caption.length
    const trigger = getMentionTrigger(caption, selectionEnd)
    const inserted = insertDraftMention(
      caption,
      captionMentions,
      candidate,
      trigger?.start ?? selectionEnd,
      selectionEnd
    )

    setCaptionMentionState({
      image,
      mentions: inserted.mentions,
      selectedIndex: 0,
      trigger: null,
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

  function setSelectedMentionIndex(selectedIndex: number) {
    setCaptionMentionState((currentState) => ({
      image,
      mentions: currentState.image === image ? currentState.mentions : [],
      selectedIndex,
      trigger: currentState.image === image ? currentState.trigger : null,
    }))
  }

  function closeMentionCandidates() {
    setCaptionMentionState((currentState) => ({
      image,
      mentions: currentState.image === image ? currentState.mentions : [],
      selectedIndex: 0,
      trigger: null,
    }))
  }

  function submitCaption() {
    onConfirm(createDraftMentionTemplate(caption, captionMentions))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[60vh] w-[60vw] max-w-[60vw] grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden sm:max-w-[60vw]"
        onOpenAutoFocus={(event) => {
          if (!image || sending) {
            return
          }

          event.preventDefault()
          captionInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">发送图片</DialogTitle>
          <DialogDescription className="sr-only">
            确认发送图片到当前会话
          </DialogDescription>
        </DialogHeader>
        {image && (
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-3">
            <div
              ref={setPreviewAreaElement}
              className={cn(
                "relative min-h-0 min-w-0 touch-none overflow-hidden rounded-md border bg-muted/20 select-none",
                zoom > 1 &&
                  (previewDragging ? "cursor-grabbing" : "cursor-grab")
              )}
              onPointerCancel={handlePreviewPointerEnd}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerEnd}
            >
              <div className="relative h-full w-full">
                {previewURL && (
                  <img
                    alt="待发送图片预览"
                    className="absolute top-1/2 left-1/2 max-w-none rounded-sm object-contain select-none"
                    draggable={false}
                    onLoad={(event) => {
                      const target = event.currentTarget
                      setImageSize({
                        height: target.naturalHeight,
                        imageKey,
                        width: target.naturalWidth,
                      })
                    }}
                    src={previewURL}
                    style={
                      previewSize
                        ? {
                            height: previewSize.height * zoom,
                            transform: `translate(-50%, -50%) translate(${clampedPreviewOffset.x}px, ${clampedPreviewOffset.y}px)`,
                            width: previewSize.width * zoom,
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            </div>
            <p className="min-w-0 text-sm text-muted-foreground">
              将要发送到{" "}
              <span className="font-medium text-foreground">
                {conversationName}
              </span>
            </p>
            <div className="relative">
              <Input
                ref={captionInputRef}
                aria-label="图片说明"
                disabled={sending}
                maxLength={5000}
                onChange={handleCaptionChange}
                onKeyDown={handleCaptionKeyDown}
                onSelect={handleCaptionSelect}
                placeholder="添加图片说明"
                value={caption}
              />
              {captionMentionTrigger &&
                filteredMentionCandidates.length > 0 && (
                  <MentionCandidateMenu
                    candidates={filteredMentionCandidates}
                    onSelect={insertCaptionMention}
                    selectedIndex={selectedMentionIndex}
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
          <Button
            disabled={!image || sending}
            onClick={submitCaption}
            type="button"
          >
            {sending && <LoaderCircle className="size-4 animate-spin" />}
            发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function getContainedSize(
  size: { height: number; width: number },
  maxWidth: number,
  maxHeight: number
) {
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height)

  return {
    height: Math.max(1, Math.round(size.height * scale)),
    width: Math.max(1, Math.round(size.width * scale)),
  }
}

function clampPreviewZoom(zoom: number) {
  return Math.min(
    maxImagePreviewZoom,
    Math.max(minImagePreviewZoom, Number(zoom.toFixed(2)))
  )
}

function clampPreviewOffset(
  offset: PreviewOffset,
  areaSize: PreviewSize,
  baseSize: PreviewSize,
  zoom: number
): PreviewOffset {
  const maxX = Math.max(0, (baseSize.width * zoom - areaSize.width) / 2)
  const maxY = Math.max(0, (baseSize.height * zoom - areaSize.height) / 2)

  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
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
        if (active) {
          setSource({ file: null, url: null })
        }
      })
      return () => {
        active = false
      }
    }

    const objectURL = URL.createObjectURL(file)

    queueMicrotask(() => {
      if (active) {
        setSource({ file, url: objectURL })
      }
    })

    return () => {
      active = false
      URL.revokeObjectURL(objectURL)
    }
  }, [file])

  return source?.file === file ? source.url : null
}
