import { useCallback, useEffect, useState } from "react"
import type { DesktopMessage } from "../../../../shared/account-data"

const MAX_SELECTED_MESSAGES = 50
const emptySelected = new Map<string, number>()

type SelectionState = {
  key: string
  active: boolean
  selected: Map<string, number>
}

export function orderedForwardMessageIds(selected: ReadonlyMap<string, number>): string[] {
  return [...selected].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

export function useMessageSelection(key: string) {
  const [state, setState] = useState<SelectionState>(() => ({
    key,
    active: false,
    selected: new Map(),
  }))
  const active = state.key === key && state.active
  const selected = state.key === key ? state.selected : emptySelected

  const cancel = useCallback(() => {
    setState({ key, active: false, selected: new Map() })
  }, [key])

  useEffect(() => {
    cancel()
  }, [cancel])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [active, cancel])

  const start = useCallback(
    (message: DesktopMessage) => {
      setState({ key, active: true, selected: new Map([[message.id, message.seq]]) })
    },
    [key],
  )

  const toggle = useCallback(
    (message: DesktopMessage) => {
      setState((current) => {
        const next = new Map(current.key === key ? current.selected : emptySelected)
        if (next.has(message.id)) next.delete(message.id)
        else if (next.size < MAX_SELECTED_MESSAGES) next.set(message.id, message.seq)
        return { key, active: true, selected: next }
      })
    },
    [key],
  )

  return { active, selected, cancel, start, toggle, maxSelectedMessages: MAX_SELECTED_MESSAGES }
}
