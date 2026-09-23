import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEventHandler,
  type RefObject,
} from "react"
import {
  ArrowUp02Icon,
  Attachment01Icon,
  Cancel01Icon,
  Analytics01Icon,
  CheckmarkSquare02Icon,
  Image01Icon,
  Loading03Icon,
  Mic01Icon,
  SmileIcon,
  SquareMIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopMessageReplyTarget } from "../../../../shared/account-data"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Toggle } from "@/components/ui/toggle"
import { formatMentionText, type MentionLabelResolver } from "@/lib/message-mentions"
import { cn } from "@/lib/utils"
import { ExpressionPickerPanel } from "../expression-picker-panel"

export function MessageComposer({
  composerRef,
  draft,
  replyTarget,
  mentionLabelResolver,
  markdownMode,
  selectingFile,
  sendingFile,
  selectingMedia,
  sendingMedia,
  importingFile,
  onFiles,
  onCancelReply,
  onDraftBlur,
  onDraftChange,
  onDraftFocus,
  onKeyDown,
  onMarkdownChange,
  onRestoreFocus,
  onInsertExpression,
  onSelectFile,
  onSelectMedia,
  onSelectChoice,
  onSelectChart,
  onSend,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  replyTarget: DesktopMessageReplyTarget | null
  mentionLabelResolver: MentionLabelResolver
  markdownMode: boolean
  selectingFile: boolean
  sendingFile: boolean
  selectingMedia: "image" | "video" | null
  sendingMedia: "image" | "video" | null
  importingFile: boolean
  onFiles: (files: File[]) => void
  onCancelReply: () => void
  onDraftBlur: () => void
  onDraftChange: (value: string) => void
  onDraftFocus: () => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onMarkdownChange: (pressed: boolean) => void
  onRestoreFocus: () => void
  onInsertExpression: (value: string) => void
  onSelectFile: () => void
  onSelectMedia: (category: "image" | "video") => void
  onSelectChoice: () => void
  onSelectChart: () => void
  onSend: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  function enterFile(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    dragDepth.current += 1
    setDragging(true)
  }

  function leaveFile(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function dropFile(event: DragEvent<HTMLElement>) {
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!importingFile) onFiles(files)
  }

  function pasteFile(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) {
      for (const item of event.clipboardData.items) {
        if (item.kind === "file") {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    }
    if (!files.length) return
    event.preventDefault()
    if (!importingFile) onFiles(files)
  }

  return (
    <footer className="flex shrink-0 flex-col gap-2 bg-card px-4 pt-1 pb-4">
      {replyTarget && (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">回复 {replyTarget.author}</div>
            <div className="truncate text-xs text-muted-foreground">
              {formatMentionText(replyTarget.summary, mentionLabelResolver)}
            </div>
          </div>
          <BeButton
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label="取消回复"
            title="取消回复"
            onClick={onCancelReply}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
          </BeButton>
        </div>
      )}
      <InputGroup
        className="bg-background"
        onDragEnter={enterFile}
        onDragLeave={leaveFile}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDrop={dropFile}
      >
        <InputGroupTextarea
          ref={composerRef}
          value={draft}
          placeholder={markdownMode ? "输入 Markdown 消息" : "输入消息"}
          className="max-h-48 min-h-24"
          onBlur={onDraftBlur}
          onChange={(event) => onDraftChange(event.target.value)}
          onFocus={onDraftFocus}
          onKeyDown={onKeyDown}
          onPaste={pasteFile}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-2">
          <div className="flex items-center gap-1">
            <Toggle
              type="button"
              size="sm"
              className="size-8 p-0 aria-pressed:text-xgui-brand"
              pressed={markdownMode}
              aria-label="支持 Markdown"
              title="支持 Markdown"
              onPressedChange={onMarkdownChange}
            >
              <HugeiconsIcon icon={SquareMIcon} className="size-4" aria-hidden />
            </Toggle>
            <ComposerExpressionPicker
              onSelect={onInsertExpression}
              onRestoreFocus={onRestoreFocus}
            />
            <ComposerButton
              label={selectingFile ? "正在选择文件" : "上传文件"}
              icon={selectingFile ? Loading03Icon : Attachment01Icon}
              disabled={selectingFile || sendingFile || importingFile}
              loading={selectingFile}
              onClick={onSelectFile}
            />
            <ComposerButton
              label={selectingMedia === "image" ? "正在读取图片" : "插入图片"}
              icon={selectingMedia === "image" ? Loading03Icon : Image01Icon}
              disabled={Boolean(selectingMedia || sendingMedia || importingFile)}
              loading={selectingMedia === "image"}
              onClick={() => onSelectMedia("image")}
            />
            <ComposerButton
              label={selectingMedia === "video" ? "正在选择视频" : "插入视频"}
              icon={selectingMedia === "video" ? Loading03Icon : Video01Icon}
              disabled={Boolean(selectingMedia || sendingMedia || importingFile)}
              loading={selectingMedia === "video"}
              onClick={() => onSelectMedia("video")}
            />
            <ComposerButton
              label="发送选择消息"
              icon={CheckmarkSquare02Icon}
              onClick={onSelectChoice}
            />
            <ComposerButton label="发送图表消息" icon={Analytics01Icon} onClick={onSelectChart} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ComposerButton label="语音输入" icon={Mic01Icon} />
            <BeButton
              type="button"
              aria-label="发送消息"
              className="gap-1 bg-xgui-brand pr-4 pl-3 text-background hover:bg-xgui-brand-4 hover:text-background active:bg-xgui-brand-5"
              size="sm"
              variant="primary"
              disabled={!draft.trim()}
              onClick={onSend}
            >
              <HugeiconsIcon icon={ArrowUp02Icon} className="size-4" aria-hidden />
              发送
            </BeButton>
          </div>
        </InputGroupAddon>
        {dragging && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-xgui-brand bg-card/90 text-sm text-xgui-brand"
            aria-hidden
          >
            松开发送文件
          </div>
        )}
      </InputGroup>
    </footer>
  )
}

function ComposerExpressionPicker({
  onSelect,
  onRestoreFocus,
}: {
  onSelect: (value: string) => void
  onRestoreFocus: () => void
}) {
  const [open, setOpen] = useState(false)

  function select(value: string) {
    setOpen(false)
    onSelect(value)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <BeButton aria-label="选择表情" title="选择表情" size="icon" variant="ghost">
          <HugeiconsIcon icon={SmileIcon} aria-hidden />
        </BeButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto p-3"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <ExpressionPickerPanel onSelect={select} />
      </PopoverContent>
    </Popover>
  )
}

function ComposerButton({
  label,
  icon,
  disabled,
  loading = false,
  onClick,
}: {
  label: string
  icon: HugeiconsIconProps["icon"]
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}) {
  return (
    <BeButton
      type="button"
      aria-label={label}
      title={label}
      size="icon"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className={cn(loading && "animate-spin")} aria-hidden />
    </BeButton>
  )
}
