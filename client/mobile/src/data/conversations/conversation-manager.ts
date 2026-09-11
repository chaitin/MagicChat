import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { ApiFetch } from "@/data/api-client"
import {
  type ConversationCacheStore,
  type ConversationPatch,
  conversationCacheStore,
  createConversationServerKey,
} from "@/data/conversations/conversation-cache-store"
import {
  publishConversationsChanged,
  subscribeConversations,
} from "@/data/conversations/conversation-events"
import { fetchConversations } from "@/data/conversations/conversations-api"
import { SharedTaskPool } from "@/data/resources/shared-task-pool"

type RefreshOptions = {
  fetcher?: ApiFetch
  signal?: AbortSignal
}

type WriteOptions = {
  observedAt?: number
  source?: "http" | "mutation"
  startedAt?: number
}

type Dependencies = {
  store: ConversationCacheStore
  fetch: (
    target: AuthenticatedTarget,
    options: { fetcher?: ApiFetch }
  ) => Promise<ClientConversation[]>
  notify: (target: AuthenticatedTarget) => void
  subscribe: typeof subscribeConversations
  now?: () => number
}

export function createConversationManager(dependencies: Dependencies) {
  const refreshTasks = new SharedTaskPool<ClientConversation[]>()
  const now = dependencies.now ?? Date.now
  const observedAtByTarget = new Map<string, number>()

  function targetKey(target: AuthenticatedTarget) {
    return JSON.stringify([createConversationServerKey(target), target.userId])
  }

  function nextObservedAt(
    target: AuthenticatedTarget,
    requestedAt = now()
  ) {
    const key = targetKey(target)
    const observedAt = Math.max(
      requestedAt,
      (observedAtByTarget.get(key) ?? 0) + 1
    )
    observedAtByTarget.set(key, observedAt)
    return observedAt
  }

  return {
    list(target: AuthenticatedTarget) {
      return dependencies.store.list(target)
    },

    get(target: AuthenticatedTarget, conversationId: string) {
      return dependencies.store.get(target, conversationId)
    },

    subscribe: dependencies.subscribe,

    beginOperation(target: AuthenticatedTarget) {
      return nextObservedAt(target)
    },

    refresh(target: AuthenticatedTarget, options: RefreshOptions = {}) {
      const requestStartedAt = nextObservedAt(target)
      return refreshTasks.run(
        targetKey(target),
        async () => {
          // A caller's signal only stops that caller waiting. It is deliberately
          // not passed to the shared HTTP operation.
          const conversations = await dependencies.fetch(target, {
            fetcher: options.fetcher,
          })
          await dependencies.store.upsertBatch(target, conversations, {
            observedAt: requestStartedAt,
            source: "http",
            startedAt: requestStartedAt,
          })
          dependencies.notify(target)
          return dependencies.store.list(target)
        },
        options.signal
      )
    },

    async upsert(
      target: AuthenticatedTarget,
      value: ClientConversation | ClientConversation[],
      options: WriteOptions = {}
    ) {
      const observedAt = nextObservedAt(target, options.observedAt)
      await dependencies.store.upsertBatch(
        target,
        Array.isArray(value) ? value : [value],
        {
          observedAt,
          source: options.source ?? "mutation",
          startedAt: options.startedAt ?? observedAt,
        }
      )
      dependencies.notify(target)
    },

    async patch(
      target: AuthenticatedTarget,
      conversationId: string,
      patch: ConversationPatch,
      options: WriteOptions = {}
    ) {
      const observedAt = nextObservedAt(target, options.observedAt)
      const changed = await dependencies.store.patch(
        target,
        conversationId,
        patch,
        {
          observedAt,
          source: options.source ?? "mutation",
          startedAt: options.startedAt ?? observedAt,
        }
      )
      if (changed) dependencies.notify(target)
      return changed
    },

    async remove(
      target: AuthenticatedTarget,
      conversationId: string,
      observedAt = now()
    ) {
      await dependencies.store.tombstone(
        target,
        [conversationId],
        nextObservedAt(target, observedAt)
      )
      dependencies.notify(target)
    },

    async removeTree(
      target: AuthenticatedTarget,
      conversationId: string,
      observedAt = now()
    ) {
      const ids = await dependencies.store.treeIds(target, conversationId)
      await dependencies.store.tombstone(
        target,
        ids,
        nextObservedAt(target, observedAt)
      )
      dependencies.notify(target)
    },
  }
}

export const conversationManager = createConversationManager({
  store: conversationCacheStore,
  fetch: (target, options) => fetchConversations(target, options),
  notify: publishConversationsChanged,
  subscribe: subscribeConversations,
})
