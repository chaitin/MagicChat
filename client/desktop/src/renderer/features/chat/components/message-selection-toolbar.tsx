import { Button } from "@/components/ui/button"

export function MessageSelectionToolbar({
  count,
  onCancel,
  onForward,
}: {
  count: number
  onCancel: () => void
  onForward: (mode: "separate" | "merged") => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-3">
      <span className="mr-auto text-sm text-muted-foreground">已选择 {count} 条消息</span>
      <Button
        type="button"
        variant="outline"
        disabled={count === 0}
        onClick={() => onForward("separate")}
      >
        逐条转发
      </Button>
      <Button type="button" disabled={count < 2} onClick={() => onForward("merged")}>
        合并转发
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </div>
  )
}
