import { useEffect, useRef } from "react"
import { UserGroupIcon } from "@hugeicons/core-free-icons"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { cn } from "@/lib/utils"
import type { MentionCandidate } from "../conversation-mentions"

export function MentionCandidateMenu({
  id,
  candidates,
  selectedIndex,
  targetId,
  theme,
  onSelect,
}: {
  id: string
  candidates: MentionCandidate[]
  selectedIndex: number
  targetId: string
  theme: "light" | "dark"
  onSelect: (candidate: MentionCandidate) => void
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex, candidates])

  return (
    <div
      id={id}
      role="listbox"
      aria-label="选择要提及的成员"
      className="absolute bottom-full left-4 z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {candidates.map((candidate, index) => (
        <button
          key={`${candidate.targetType}-${candidate.id}`}
          ref={(node) => {
            optionRefs.current[index] = node
          }}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent",
            index === selectedIndex && "bg-accent",
          )}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(candidate)
          }}
        >
          {candidate.targetType === "all" ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-teal-500 text-white">
              <HugeiconsIcon icon={UserGroupIcon} className="size-4" aria-hidden />
            </span>
          ) : (
            <EntityAvatar
              targetId={targetId}
              type={candidate.targetType}
              id={candidate.id}
              theme={theme}
              label={candidate.label}
              size={24}
            />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm">{candidate.label}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {candidate.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
