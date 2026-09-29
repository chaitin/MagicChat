import { useEffect, useRef, useState, type UIEvent } from "react"

// 24px avatar + 8px vertical padding + 2px border + 4px row gap.
export const CANDIDATE_ROW_HEIGHT = 38
const VISIBLE_ROWS = Math.ceil(256 / CANDIDATE_ROW_HEIGHT) + 1
const OVERSCAN_ROWS = 4

export function virtualCandidateRange(count: number, firstVisible: number) {
  const visible = Math.min(Math.max(0, firstVisible), Math.max(0, count - VISIBLE_ROWS))
  const start = Math.max(0, visible - OVERSCAN_ROWS)
  const end = Math.min(count, visible + VISIBLE_ROWS + OVERSCAN_ROWS)
  return { start, end, height: Math.max(0, count * CANDIDATE_ROW_HEIGHT - 4) }
}

export function useVirtualCandidateRows(count: number, resetKey: string) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [firstVisible, setFirstVisible] = useState(0)

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0
    setFirstVisible(0)
  }, [resetKey])

  function onViewportScroll(event: UIEvent<HTMLDivElement>) {
    setFirstVisible(Math.floor(event.currentTarget.scrollTop / CANDIDATE_ROW_HEIGHT))
  }

  return { viewportRef, onViewportScroll, ...virtualCandidateRange(count, firstVisible) }
}
