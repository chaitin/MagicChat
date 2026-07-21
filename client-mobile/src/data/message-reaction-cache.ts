import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import type {
  ClientMessage,
  ClientMessageList,
  MessageReactionsUpdatedEvent,
  MessageReactionSnapshot,
} from "@/data/models"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"
import {
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
} from "@/domain/messages/message-reactions"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>

export type CachedReactionUpdateStatus =
  | "applied"
  | "gap"
  | "missing"
  | "stale"

export function updateCachedMessageReactionSnapshot(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  snapshot: MessageReactionSnapshot
) {
  queryClient.setQueryData<MessageInfiniteData>(
    queryKeys.conversationMessages(server, snapshot.conversationId),
    (current) =>
      updateMessagePages(current, snapshot.messageId, (message) =>
        applyMessageReactionSnapshot(message, snapshot)
      ).data
  )
}

export function applyCachedMessageReactionsUpdate(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  event: MessageReactionsUpdatedEvent
): CachedReactionUpdateStatus {
  let status: CachedReactionUpdateStatus = "missing"

  queryClient.setQueryData<MessageInfiniteData>(
    queryKeys.conversationMessages(server, event.conversationId),
    (current) => {
      const updated = updateMessagePages(current, event.messageId, (message) => {
        const result = applyMessageReactionsUpdate(
          message,
          event,
          server.userId
        )
        status = result.status
        return result.message
      })
      if (updated.found && status === "missing") status = "stale"
      return updated.data
    }
  )

  return status
}

function updateMessagePages(
  current: MessageInfiniteData | undefined,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  if (!current) return { data: current, found: false }

  let changed = false
  let found = false
  const pages = current.pages.map((page) => {
    let pageChanged = false
    const messages = page.messages.map((message) => {
      if (message.id !== messageId) return message

      found = true
      const nextMessage = update(message)
      if (nextMessage !== message) {
        changed = true
        pageChanged = true
      }
      return nextMessage
    })
    return pageChanged ? { ...page, messages } : page
  })

  return {
    data: changed ? { ...current, pages } : current,
    found,
  }
}
