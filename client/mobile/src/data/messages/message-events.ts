import type {
  ClientMessage,
  ClientMessageList,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
} from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"

export type ConversationMessagesChangedEvent =
  | { page: ClientMessageList; type: "latest-page" }
  | { messages: ClientMessage[]; type: "upsert" }
  | { messageIds: string[]; type: "remove" }
  | { snapshot: MessageChoiceSnapshot; type: "choice-snapshot" }
  | { event: MessageChoiceUpdatedEvent; type: "choice-event" }
  | { type: "clear" }

type MessageListener = (event: ConversationMessagesChangedEvent) => void

const listeners = new Map<string, Set<MessageListener>>()
const scopeListeners = new Map<string, Set<(conversationId: string, event: ConversationMessagesChangedEvent) => void>>()
const cacheClearListeners = new Set<() => void>()

export function subscribeMessageChanges(
  target: AuthenticatedTarget,
  listener: (conversationId: string, event: ConversationMessagesChangedEvent) => void
) {
  const key = createScopeEventKey(target)
  const current = scopeListeners.get(key) ?? new Set()
  current.add(listener)
  scopeListeners.set(key, current)
  return () => {
    current.delete(listener)
    if (current.size === 0) scopeListeners.delete(key)
  }
}

export function subscribeAllMessageCacheCleared(listener: () => void) {
  cacheClearListeners.add(listener)
  return () => { cacheClearListeners.delete(listener) }
}

export function publishAllMessageCacheCleared() {
  for (const listener of cacheClearListeners) {
    try { listener() } catch { /* A presentation subscriber must not fail maintenance. */ }
  }
}

export function subscribeConversationMessages(
  target: AuthenticatedTarget,
  conversationId: string,
  listener: MessageListener
) {
  const key = createConversationEventKey(target, conversationId)
  const current = listeners.get(key) ?? new Set<MessageListener>()
  current.add(listener)
  listeners.set(key, current)

  return () => {
    current.delete(listener)
    if (current.size === 0) listeners.delete(key)
  }
}

export function publishConversationMessagesChanged(
  target: AuthenticatedTarget,
  conversationId: string,
  event: ConversationMessagesChangedEvent
) {
  const current = listeners.get(
    createConversationEventKey(target, conversationId)
  )
  for (const listener of current ?? []) {
    try {
      listener(event)
    } catch {
      // One presentation subscriber must not make a committed message write fail.
    }
  }
  for (const listener of scopeListeners.get(createScopeEventKey(target)) ?? []) {
    try {
      listener(conversationId, event)
    } catch {
      // One presentation subscriber must not make a committed message write fail.
    }
  }
}

function createConversationEventKey(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return JSON.stringify([
    target.id,
    target.url,
    target.userId,
    conversationId,
  ])
}

function createScopeEventKey(target: AuthenticatedTarget) {
  return JSON.stringify([target.id, target.url, target.userId])
}
