import { forwardRef } from "react"
import { HugeiconsIcon as BaseHugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react"

export type { HugeiconsIconProps }

export const HugeiconsIcon = forwardRef<SVGSVGElement, HugeiconsIconProps>(
  function HugeiconsIcon(props, ref) {
    return <BaseHugeiconsIcon {...props} ref={ref} strokeWidth={2} />
  },
)
