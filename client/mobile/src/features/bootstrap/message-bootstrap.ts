import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { flattenVisibleConversations } from "@/domain/conversations/conversation-order"

export const MESSAGE_BOOTSTRAP_CONVERSATION_LIMIT = 30
export const MESSAGE_BOOTSTRAP_MESSAGE_LIMIT = 20
export const MESSAGE_BOOTSTRAP_CONCURRENCY = 5
export const MESSAGE_BOOTSTRAP_LOCAL_CONCURRENCY = 5
export const MESSAGE_BOOTSTRAP_TIMEOUT_MS = 30_000

export type MessageBootstrapDependencies = {
  listLocalConversations: (
    target: AuthenticatedTarget
  ) => Promise<ClientConversation[]>
  refreshConversations: (
    target: AuthenticatedTarget
  ) => Promise<ClientConversation[]>
  synchronizeLatest: (
    target: AuthenticatedTarget,
    conversationId: string,
    limit: number
  ) => Promise<ClientMessageList>
  readLatestPage: (
    target: AuthenticatedTarget,
    conversationId: string,
    limit: number
  ) => Promise<ClientMessageList>
  isUnauthorizedError: (error: unknown) => boolean
}

export function createMessageBootstrap(
  dependencies: MessageBootstrapDependencies,
  timeoutMs = MESSAGE_BOOTSTRAP_TIMEOUT_MS,
  completedFlightRetentionMs = 1_000
) {
  const flights = new Map<string, Promise<ReadonlyMap<string, ClientMessageList>>>()

  return (
    target: AuthenticatedTarget,
    onPage?: (conversationId: string, page: ClientMessageList) => void
  ) => {
    const key = JSON.stringify([target.id, target.url, target.userId])
    const existing = flights.get(key)
    if (existing) return existing

    const results = new Map<string, ClientMessageList>()
    const work = runBoundedBootstrap(target, dependencies, results, onPage)
    const flight = withTimeout(work, results, timeoutMs)
    // Coalesce login -> Provider's immediate duplicate, but do not turn a
    // completed/timed-out bootstrap into a permanent target cache. Late work
    // keeps publishing through onPage after the timeout resolves.
    flights.set(key, flight)
    void flight.then(
      () => setTimeout(() => {
        if (flights.get(key) === flight) flights.delete(key)
      }, completedFlightRetentionMs),
      () => flights.delete(key)
    )
    return flight
  }
}

async function runBoundedBootstrap(
  target: AuthenticatedTarget,
  dependencies: MessageBootstrapDependencies,
  results: Map<string, ClientMessageList>,
  onPage?: (conversationId: string, page: ClientMessageList) => void
) {
  // Local hydration is independent of server availability and starts alongside refresh.
  const hydrateLocal = dependencies
    .listLocalConversations(target)
    .then((conversations) =>
      runWithConcurrency(
        conversations,
        MESSAGE_BOOTSTRAP_LOCAL_CONCURRENCY,
        async (conversation) => {
          await dependencies
            .readLatestPage(
              target,
              conversation.id,
              MESSAGE_BOOTSTRAP_MESSAGE_LIMIT
            )
            .then((page) => {
              // A concurrent network result is authoritative and may contain a newer seq.
              if (page.messages.length > 0 && !results.has(conversation.id)) {
                results.set(conversation.id, page)
                onPage?.(conversation.id, page)
              }
            })
            .catch(() => undefined)
        }
      )
    )
    .catch(() => undefined)

  const synchronizeNetwork = dependencies
    .refreshConversations(target)
    .then((conversations) =>
      // Network synchronization deliberately remains limited to the refreshed top 30.
      runWithConcurrency(
        flattenVisibleConversations(conversations).slice(
          0,
          MESSAGE_BOOTSTRAP_CONVERSATION_LIMIT
        ),
        MESSAGE_BOOTSTRAP_CONCURRENCY,
        async (conversation) => {
          await dependencies
            .synchronizeLatest(
              target,
              conversation.id,
              MESSAGE_BOOTSTRAP_MESSAGE_LIMIT
            )
            .then((page) => {
              results.set(conversation.id, page)
              onPage?.(conversation.id, page)
            })
            .catch((error: unknown) => {
              if (dependencies.isUnauthorizedError(error)) throw error
            })
        }
      )
    )
    .catch((error: unknown) => {
      // Offline refresh is non-fatal, but authentication failures must keep logging out.
      if (dependencies.isUnauthorizedError(error)) throw error
    })

  await Promise.all([hydrateLocal, synchronizeNetwork])
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>
) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        await operation(items[next++]!)
      }
    })
  )
}

function withTimeout<T>(work: Promise<void>, result: T, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => resolve(result), timeoutMs)
    void work.then(
      () => {
        clearTimeout(timeout)
        resolve(result)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}
