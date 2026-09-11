import * as React from "react"

import {
  ExpressionPicker,
  type ExpressionItem,
} from "@/components/expression-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type ExpressionPickerPopoverProps = {
  align?: "start" | "center" | "end"
  children: React.ReactElement
  onOpenChange?: (open: boolean) => void
  onSelect: (item: ExpressionItem) => void
  open?: boolean
  side?: "top" | "right" | "bottom" | "left"
}

export function ExpressionPickerPopover({
  align = "start",
  children,
  onOpenChange,
  onSelect,
  open: controlledOpen,
  side = "top",
}: ExpressionPickerPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen

  function setOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  function handleSelect(item: ExpressionItem) {
    onSelect(item)
    setOpen(false)
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-3" side={side}>
        <ExpressionPicker onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  )
}
