import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CopyCommandButton() {
  return (
    <Button type="button" variant="ghost" size="sm" motion={false} data-copy-command data-copy-state="idle" aria-label="复制一键安装命令">
      <Copy data-copy-icon aria-hidden="true" />
      <Check data-copy-check aria-hidden="true" />
      <span data-copy-label aria-live="polite">复制命令</span>
    </Button>
  )
}
