import { cn } from "cn"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Loading03Icon } from "@hugeicons/core-free-icons"

function Spinner({ className, strokeWidth, ...props }: React.ComponentProps<"svg">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={typeof strokeWidth === "number" ? strokeWidth : Number(strokeWidth ?? 2)}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
