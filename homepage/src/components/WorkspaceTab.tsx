import { MessagesSquare, SquareCheck, ShieldCheck, Plug } from "lucide-react"
import { Button } from "@/components/ui/button"

const icons = { context: MessagesSquare, tasks: SquareCheck, permissions: ShieldCheck, integrations: Plug }

export function WorkspaceTab({ id, title }: { id: keyof typeof icons; title: string }) {
  const Icon = icons[id]
  return (
    <Button variant="ghost" motion={false} type="button" id={`tab-${id}`} data-workspace-tab={id} aria-controls={`panel-${id}`}>
      <Icon aria-hidden="true" /><span>{title}</span>
    </Button>
  )
}
