import * as React from "react"

const maxSelectedMessages = 50

type MessageSelectionState = {
  active: boolean
  conversationId: string
  selectedMessageIds: Set<string>
}

const emptySelectedMessageIds = new Set<string>()

export function useMessageSelection(conversationId: string) {
  const [state, setState] = React.useState<MessageSelectionState>(() => ({
    active: false,
    conversationId,
    selectedMessageIds: new Set(),
  }))
  const stateMatchesConversation = state.conversationId === conversationId
  const active = stateMatchesConversation && state.active
  const selectedMessageIds = stateMatchesConversation
    ? state.selectedMessageIds
    : emptySelectedMessageIds

  const cancel = React.useCallback(() => {
    setState({
      active: false,
      conversationId,
      selectedMessageIds: new Set(),
    })
  }, [conversationId])

  React.useEffect(() => {
    if (!active) {
      return
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        cancel()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [active, cancel])

  const start = React.useCallback(
    (messageId: string) => {
      setState({
        active: true,
        conversationId,
        selectedMessageIds: new Set([messageId]),
      })
    },
    [conversationId]
  )

  const toggle = React.useCallback(
    (messageId: string) => {
      setState((current) => {
        const selected =
          current.conversationId === conversationId
            ? current.selectedMessageIds
            : emptySelectedMessageIds
        const next = new Set(selected)
        if (next.has(messageId)) {
          next.delete(messageId)
        } else if (next.size < maxSelectedMessages) {
          next.add(messageId)
        }
        return {
          active: true,
          conversationId,
          selectedMessageIds: next,
        }
      })
    },
    [conversationId]
  )

  return {
    active,
    cancel,
    maxSelectedMessages,
    selectedMessageIds,
    start,
    toggle,
  }
}
