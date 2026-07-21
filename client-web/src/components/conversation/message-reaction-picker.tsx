import { SmilePlus } from "lucide-react"

import { ExpressionPickerPopover } from "@/components/expression-picker-popover"
import { cn } from "@/lib/utils"

export function MessageReactionPicker({
  align,
  disabled,
  onSelect,
}: {
  align: "start" | "end"
  disabled?: boolean
  onSelect: (text: string) => void
}) {
  return (
    <ExpressionPickerPopover
      align={align}
      onSelect={(item) => onSelect(item.value)}
    >
      <button
        aria-label="添加表情"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors",
          "opacity-0 group-hover/message-row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          "hover:border-teal-300 hover:text-teal-600 dark:hover:border-teal-700 dark:hover:text-teal-400"
        )}
        data-slot="message-reaction-add"
        disabled={disabled}
        type="button"
      >
        <SmilePlus className="size-3.5" />
      </button>
    </ExpressionPickerPopover>
  )
}
