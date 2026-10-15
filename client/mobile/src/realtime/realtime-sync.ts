import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import type { ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { isUnauthorizedError } from "@/data/api-client"
import { contactManager } from "@/data/contacts"
import { isUnavailableConversation } from "@/data/messages/automatic-message-sync"
import { createClientMessageSyncRound } from "@/data/messages/client-message-sync"
import { projectManager } from "@/data/projects"
import { queryKeys } from "@/data/query"
import { traceMobileStartup } from "@/diagnostics/mobile-startup"
import { AUTO_MESSAGE_PAGE_SIZE } from "@/domain/messages/message-sync-budget"
import { synchronizeConversationMessageChoices } from "./choice-sync"
import { synchronizeConversationMessageReactions } from "./reaction-sync"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>
type SyncOptions = {
  freshSnapshot?: boolean
  activeConversationId?: string
  getActiveConversationId?: () => string
  isCurrent?: () => boolean
}

export function createRealtimeSynchronization(queryClient: QueryClient, server: AuthenticatedTarget, options: SyncOptions = {}) {
  const activeId = () => options.getActiveConversationId?.() ?? options.activeConversationId ?? ""
  let synchronizeMessages: ReturnType<typeof createClientMessageSyncRound> | undefined
  const completedStates = new Set<string>()

  return async () => {
    if (options.isCurrent?.() === false) return
    synchronizeMessages ??= createClientMessageSyncRound(server, {
      freshSnapshot: options.freshSnapshot,
      activeConversationId: activeId(),
      getCachedSeq: (id) => {
        const data = queryClient.getQueryData<MessageInfiniteData>(queryKeys.conversationMessages(server, id))
        return data?.pages.reduce((newest, page) => Math.max(newest, ...page.messages.map((message) => message.seq)), 0) ?? 0
      },
    })
    await synchronizeMessages()
    if (options.isCurrent?.() === false) return

    // A cached bootstrap page is not an open chat. Only calibrate the current chat's latest page.
    const id = activeId()
    if (!id) return
    const data = queryClient.getQueryData<MessageInfiniteData>(queryKeys.conversationMessages(server, id))
    const messages = [...new Map(data?.pages.flatMap((page) => page.messages.map((message) => [message.id, message] as const)) ?? []).values()]
      .sort((left, right) => right.seq - left.seq)
      .slice(0, AUTO_MESSAGE_PAGE_SIZE)
    if (!messages.length) return

    const startedAt = performance.now()
    const reactions = messages.map((message) => message.id)
    const choices = messages.filter((message) => message.body.type === "choice").map((message) => message.id)
    const synchronizeState = async (kind: string, ids: string[], operation: () => Promise<void>) => {
      const key = JSON.stringify([id, kind, ids])
      if (!ids.length || completedStates.has(key)) return
      try { await operation() }
      catch (error) { if (!isUnavailableConversation(error)) throw error }
      completedStates.add(key)
    }
    const results = await Promise.allSettled([
      synchronizeState("reactions", reactions, () => synchronizeConversationMessageReactions(queryClient, server, id, reactions)),
      synchronizeState("choices", choices, () => synchronizeConversationMessageChoices(queryClient, server, id, choices)),
    ])
    const failed = results.find((result) => result.status === "rejected" && isUnauthorizedError(result.reason)) ?? results.find((result) => result.status === "rejected")
    traceMobileStartup(failed ? "sync.current-state.failed" : "sync.current-state.ready", {
      count: messages.length, failures: results.filter((result) => result.status === "rejected").length, elapsedMs: performance.now() - startedAt,
    })
    if (failed?.status === "rejected") throw failed.reason
  }
}

export function synchronizeRealtimeData(queryClient: QueryClient, server: AuthenticatedTarget, options: SyncOptions = {}) {
  return createRealtimeSynchronization(queryClient, server, options)()
}

export async function refreshClientDataOnForeground(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: SyncOptions & { messagesAlreadySynchronizing?: boolean } = {}
) {
  await Promise.all([
    contactManager.refresh(server),
    queryClient.invalidateQueries({ exact: true, queryKey: queryKeys.currentUser(server) }, { cancelRefetch: false }),
    projectManager.refresh(server),
    options.messagesAlreadySynchronizing ? Promise.resolve() : synchronizeRealtimeData(queryClient, server, options),
  ])
}
