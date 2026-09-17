import { useState } from "react"
import { SmilePlusIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ExpressionPickerPanel } from "./expression-picker-panel"

export function MessageReactionPicker({
  align,
  onSelect,
}: {
  align: "start" | "end"
  onSelect: (text: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  function select(value: string) {
    if (pending) return
    setOpen(false)
    setPending(true)
    void onSelect(value).finally(() => setPending(false))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs outline-none transition-colors hover:text-xgui-brand focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          aria-label="添加表情"
          title="添加表情"
          disabled={pending}
        >
          <HugeiconsIcon icon={SmilePlusIcon} className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align={align} className="w-auto p-3">
        <ExpressionPickerPanel onSelect={select} />
      </PopoverContent>
    </Popover>
  )
}
