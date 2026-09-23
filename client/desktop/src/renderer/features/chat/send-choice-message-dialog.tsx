import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import {
  Delete02Icon,
  DragDropVerticalIcon,
  Loading03Icon,
  PlusSignIcon,
  SquareMIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import type { SendRichMessageBody } from "../../../shared/account-data"

function newOption() {
  return { id: crypto.randomUUID(), label: "" }
}

export function SendChoiceMessageDialog({
  open,
  conversationName,
  onOpenChange,
  onSend,
}: {
  open: boolean
  conversationName: string
  onOpenChange: (open: boolean) => void
  onSend: (body: SendRichMessageBody) => Promise<void>
}) {
  const selectionId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const { showToast } = useAnimatedToast()
  const [content, setContent] = useState("")
  const [contentType, setContentType] = useState<"text" | "markdown">("text")
  const [selection, setSelection] = useState<"single" | "multiple">("single")
  const [options, setOptions] = useState(() => [newOption(), newOption()])
  const draggedOptionId = useRef<string | null>(null)
  const [draggingOptionId, setDraggingOptionId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<{ field: string; message: string } | null>(null)

  function reset() {
    setContent("")
    setContentType("text")
    setSelection("single")
    setOptions([newOption(), newOption()])
    draggedOptionId.current = null
    setDraggingOptionId(null)
    setDropTargetId(null)
    setError(null)
  }

  function moveOption(fromId: string, toId: string) {
    if (fromId === toId) return
    setOptions((current) => {
      const from = current.findIndex((option) => option.id === fromId)
      const to = current.findIndex((option) => option.id === toId)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function startDrag(event: DragEvent<HTMLSpanElement>, id: string) {
    if (sending) {
      event.preventDefault()
      return
    }
    const row = event.currentTarget.parentElement
    if (row) {
      const bounds = row.getBoundingClientRect()
      event.dataTransfer.setDragImage(row, event.clientX - bounds.left, event.clientY - bounds.top)
    }
    draggedOptionId.current = id
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", id)
    setDraggingOptionId(id)
  }

  function finishDrag() {
    draggedOptionId.current = null
    setDraggingOptionId(null)
    setDropTargetId(null)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, id: string) {
    if (!draggedOptionId.current || draggedOptionId.current === id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDropTargetId(id)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, id: string) {
    if (!draggedOptionId.current) return
    event.preventDefault()
    moveOption(draggedOptionId.current, id)
    finishDrag()
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLSpanElement>, index: number) {
    if (sending) return
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1
    if (to < 0 || to >= options.length) return
    event.preventDefault()
    moveOption(options[index].id, options[to].id)
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    function validationError(field: string, message: string) {
      setError({ field, message })
      showToast({ status: "error", title: message })
      formRef.current?.querySelector<HTMLElement>(`[data-choice-field="${field}"]`)?.focus()
    }
    if (!content.trim()) {
      validationError("content", "请填写选择内容")
      return
    }
    const emptyOption = options.find((option) => !option.label.trim())
    if (emptyOption) {
      validationError(`option-${emptyOption.id}`, "请填写所有选项")
      return
    }
    const labels = options.map((option) => option.label.trim())
    const invalidOption = labels.findIndex((label) => /[\p{Cc}\u2028\u2029]/u.test(label))
    if (invalidOption !== -1) {
      validationError(`option-${options[invalidOption].id}`, "选项内容不能包含换行或控制字符")
      return
    }
    setSending(true)
    setError(null)
    try {
      await onSend({
        type: "choice",
        content: content.trim(),
        contentType,
        selection,
        options: labels.map((label, index) => ({ id: `option-${index + 1}`, label })),
      })
      reset()
      onOpenChange(false)
    } catch (cause) {
      showToast({
        status: "error",
        title: cause instanceof Error ? cause.message : "发送选择消息失败",
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>发送选择消息</DialogTitle>
          <DialogDescription className="sr-only">发送到 {conversationName}</DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          noValidate
          className="grid min-h-0 gap-4"
          onChangeCapture={() => setError(null)}
          onSubmit={(event) => void submit(event)}
        >
          <ScrollArea
            type="auto"
            className="-mr-5 -ml-1 min-w-0 max-h-[calc(85vh-11rem)] overflow-hidden"
            viewportClassName="h-auto max-h-[calc(85vh-11rem)] pr-5 pl-1"
          >
            <div className="grid gap-4">
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">选择方式</legend>
                <RadioGroup
                  className="grid-cols-2 gap-2"
                  value={selection}
                  onValueChange={(value) => setSelection(value as typeof selection)}
                >
                  {(
                    [
                      ["single", "单选"],
                      ["multiple", "多选"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      htmlFor={`${selectionId}-${value}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 transition-colors hover:border-foreground/30 hover:bg-muted/50",
                        selection === value && "border-foreground/40 bg-muted",
                      )}
                    >
                      <RadioGroupItem id={`${selectionId}-${value}`} value={value} />
                      <span>{label}</span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
              <div className="grid gap-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <label htmlFor={`${selectionId}-content`}>文本消息内容</label>
                  <Toggle
                    type="button"
                    size="sm"
                    className="size-6 min-w-6 p-0 aria-pressed:text-xgui-brand"
                    pressed={contentType === "markdown"}
                    aria-label="支持 Markdown"
                    title="支持 Markdown"
                    onPressedChange={(pressed) => setContentType(pressed ? "markdown" : "text")}
                  >
                    <HugeiconsIcon icon={SquareMIcon} className="size-3.5" aria-hidden />
                  </Toggle>
                </div>
                <Textarea
                  id={`${selectionId}-content`}
                  data-choice-field="content"
                  className={contentType === "markdown" ? "font-mono" : undefined}
                  maxLength={5000}
                  required
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="请输入问题或说明"
                />
                {error?.field === "content" && (
                  <span className="text-sm text-destructive">{error.message}</span>
                )}
              </div>
              <div className="grid gap-2">
                <span className="text-sm">选项</span>
                {options.map((option, index) => (
                  <div key={option.id} className="grid gap-1">
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-md",
                        draggingOptionId === option.id && "opacity-40",
                        dropTargetId === option.id && "bg-muted",
                      )}
                      onDragOver={(event) => handleDragOver(event, option.id)}
                      onDrop={(event) => handleDrop(event, option.id)}
                    >
                      <span
                        role="button"
                        tabIndex={sending ? -1 : 0}
                        aria-disabled={sending}
                        aria-label={`拖动选项 ${index + 1} 排序，或按上下方向键调整`}
                        title="拖动排序，或按上下方向键调整"
                        className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
                        draggable={!sending}
                        onDragStart={(event) => startDrag(event, option.id)}
                        onDragEnd={finishDrag}
                        onKeyDown={(event) => handleHandleKeyDown(event, index)}
                      >
                        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" aria-hidden />
                      </span>
                      <Input
                        data-choice-field={`option-${option.id}`}
                        aria-label={`选项 ${index + 1}`}
                        maxLength={200}
                        placeholder={`选项 ${index + 1}`}
                        required
                        value={option.label}
                        onChange={(event) =>
                          setOptions((current) =>
                            current.map((item) =>
                              item.id === option.id ? { ...item, label: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除选项 ${index + 1}`}
                        disabled={options.length <= 2}
                        onClick={() =>
                          setOptions((current) => current.filter((item) => item.id !== option.id))
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {error?.field === `option-${option.id}` && (
                      <span className="ml-6 text-sm text-destructive">{error.message}</span>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={options.length >= 20}
                  onClick={() => setOptions((current) => [...current, newOption()])}
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" aria-hidden />
                  添加选项
                </Button>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="bg-xgui-brand text-primary-foreground hover:bg-xgui-brand-4"
              disabled={sending}
            >
              {sending && (
                <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
              )}
              发送
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
