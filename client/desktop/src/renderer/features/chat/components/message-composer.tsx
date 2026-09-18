import { useState, type KeyboardEventHandler, type RefObject } from "react"
import {
  ArrowUp02Icon,
  Attachment01Icon,
  Image01Icon,
  Loading03Icon,
  Mic01Icon,
  SmileIcon,
  SquareMIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { ExpressionPickerPanel } from "../expression-picker-panel"

export function MessageComposer({
  composerRef,
  draft,
  markdownMode,
  selectingFile,
  sendingFile,
  selectingMedia,
  sendingMedia,
  onDraftChange,
  onKeyDown,
  onMarkdownChange,
  onRestoreFocus,
  onInsertExpression,
  onSelectFile,
  onSelectMedia,
  onSend,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  markdownMode: boolean
  selectingFile: boolean
  sendingFile: boolean
  selectingMedia: "image" | "video" | null
  sendingMedia: "image" | "video" | null
  onDraftChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onMarkdownChange: (pressed: boolean) => void
  onRestoreFocus: () => void
  onInsertExpression: (value: string) => void
  onSelectFile: () => void
  onSelectMedia: (category: "image" | "video") => void
  onSend: () => void
}) {
  return (
    <footer className="shrink-0 bg-card p-4">
      <InputGroup className="bg-background">
        <InputGroupTextarea
          ref={composerRef}
          value={draft}
          placeholder={markdownMode ? "输入 Markdown 消息" : "输入消息"}
          className="max-h-48 min-h-24"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
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
              disabled={selectingFile || sendingFile}
              loading={selectingFile}
              onClick={onSelectFile}
            />
            <ComposerButton
              label={selectingMedia === "image" ? "正在读取图片" : "插入图片"}
              icon={selectingMedia === "image" ? Loading03Icon : Image01Icon}
              disabled={Boolean(selectingMedia || sendingMedia)}
              loading={selectingMedia === "image"}
              onClick={() => onSelectMedia("image")}
            />
            <ComposerButton
              label={selectingMedia === "video" ? "正在选择视频" : "插入视频"}
              icon={selectingMedia === "video" ? Loading03Icon : Video01Icon}
              disabled={Boolean(selectingMedia || sendingMedia)}
              loading={selectingMedia === "video"}
              onClick={() => onSelectMedia("video")}
            />
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
