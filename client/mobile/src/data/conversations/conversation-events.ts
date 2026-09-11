import type { AuthenticatedTarget } from "@/core/server-target"
import { createConversationServerKey } from "@/data/conversations/conversation-cache-store"

export type ConversationsChangedEvent = { type: "changed" }
type ConversationListener = (event: ConversationsChangedEvent) => void

const listeners = new Map<string, Set<ConversationListener>>()

function targetKey(target: AuthenticatedTarget) {
  return JSON.stringify([createConversationServerKey(target), target.userId])
}

export function subscribeConversations(
  target: AuthenticatedTarget,
  listener: ConversationListener
) {
  const key = targetKey(target)
  const current = listeners.get(key) ?? new Set<ConversationListener>()
  current.add(listener)
  listeners.set(key, current)

  return () => {
    current.delete(listener)
    if (current.size === 0) listeners.delete(key)
  }
}

export function publishConversationsChanged(target: AuthenticatedTarget) {
  for (const listener of listeners.get(targetKey(target)) ?? []) {
    try {
      listener({ type: "changed" })
    } catch {
      // A presentation subscriber cannot make a committed cache write fail.
    }
  }
}
