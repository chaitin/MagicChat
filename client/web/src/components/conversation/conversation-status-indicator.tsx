import { cn } from "@/lib/utils"

export function ConversationStatusIndicator({
  className,
  status,
}: {
  className?: string
  status: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span>{status}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {[-0.3, -0.15, 0].map((delay) => (
          <span
            className="size-1 animate-bounce rounded-full bg-current motion-reduce:animate-none"
            data-status-dot
            key={delay}
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </span>
  )
}
