import * as React from "react"
import { UsersRound } from "lucide-react"

import { getAvatarInitial } from "@/lib/avatar"
import {
  getVisibleMentionIndex,
  type MentionCandidate,
} from "@/lib/conversation-composer"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

export function MentionCandidateMenu({
  candidates,
  className,
  onSelect,
  selectedIndex,
}: {
  candidates: MentionCandidate[]
  className?: string
  onSelect: (candidate: MentionCandidate) => void
  selectedIndex: number
}) {
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const visibleSelectedIndex = getVisibleMentionIndex(
    selectedIndex,
    candidates.length
  )

  React.useEffect(() => {
    optionRefs.current[visibleSelectedIndex]?.scrollIntoView({
      block: "nearest",
    })
  }, [candidates, visibleSelectedIndex])

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className
      )}
    >
      {candidates.map((candidate, index) => (
        <Button
          key={`${candidate.targetType}-${candidate.id}`}
          ref={(element) => {
            optionRefs.current[index] = element
          }}
          className={cn(
            "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left",
            index === visibleSelectedIndex && "bg-accent"
          )}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(candidate)
          }}
          type="button"
          variant="ghost"
        >
          <Avatar
            className={cn(
              "size-6 rounded-sm after:rounded-sm",
              candidate.targetType === "all" ? "bg-teal-500" : "bg-muted"
            )}
            data-size="sm"
          >
            {candidate.targetType === "all" ? (
              <AvatarFallback className="rounded-sm bg-transparent text-background">
                <UsersRound className="size-3.5" />
              </AvatarFallback>
            ) : candidate.avatar ? (
              <AvatarImage
                alt={candidate.label}
                className="rounded-sm"
                src={candidate.avatar}
              />
            ) : (
              <AvatarFallback className="rounded-sm text-xs">
                {getAvatarInitial(candidate.label)}
              </AvatarFallback>
            )}
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{candidate.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {candidate.description}
            </span>
          </span>
        </Button>
      ))}
    </div>
  )
}
