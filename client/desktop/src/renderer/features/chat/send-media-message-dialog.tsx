import { useRef } from "react"
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
import { cn } from "@/lib/utils"

export function SendMediaMessageDialog({
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
  category: "image" | "video"
  caption: string
  conversationName: string
  open: boolean
  resourceUrl: string
  sending: boolean
  onCaptionChange: (caption: string) => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const captionInputRef = useRef<HTMLInputElement>(null)
  const label = category === "image" ? "图片" : "视频"

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
            <BeInput
              ref={captionInputRef}
              aria-label={`${label}说明`}
              disabled={sending}
              maxLength={5000}
              placeholder={`添加${label}说明`}
              value={caption}
              onChange={onCaptionChange}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && !sending) {
                  event.preventDefault()
                  onConfirm()
                }
              }}
            />
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <BeButton type="button" variant="outline" disabled={sending}>
              取消
            </BeButton>
          </DialogClose>
          <BeButton type="button" disabled={!resourceUrl || sending} onClick={onConfirm}>
            {sending && <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />}
            发送
          </BeButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
