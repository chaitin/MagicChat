import { useRef } from "react"
import { File01Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatFileSize } from "@/lib/file-format"
import type { SelectedMessageFile } from "../../../shared/account-data"

export function SendFileMessageDialog({
  conversationName,
  file,
  open,
  sending,
  onConfirm,
  onOpenChange,
}: {
  conversationName: string
  file: SelectedMessageFile | null
  open: boolean
  sending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          if (!file || sending) return
          event.preventDefault()
          confirmButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base">发送文件</DialogTitle>
          <DialogDescription className="sr-only">确认发送文件到当前会话</DialogDescription>
        </DialogHeader>
        {file && (
          <div className="grid gap-3">
            <div className="flex min-w-0 items-center gap-3 rounded-md border p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <HugeiconsIcon icon={File01Icon} className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</p>
              </div>
            </div>
            <p className="min-w-0 text-sm text-muted-foreground">
              将要发送到 <span className="font-medium text-foreground">{conversationName}</span>
            </p>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <BeButton type="button" variant="outline" disabled={sending}>
              取消
            </BeButton>
          </DialogClose>
          <BeButton
            ref={confirmButtonRef}
            type="button"
            disabled={!file || sending}
            onClick={onConfirm}
          >
            {sending && <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />}
            发送
          </BeButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
