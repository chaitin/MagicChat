import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { traceMobileStartup } from "@/diagnostics/mobile-startup"

export const MESSAGE_BOOTSTRAP_MESSAGE_LIMIT = 20
export const MESSAGE_BOOTSTRAP_LOCAL_CONCURRENCY = 5
export const MESSAGE_BOOTSTRAP_TIMEOUT_MS = 30_000

export type MessageBootstrapDependencies = {
  listLocalConversations: (target: AuthenticatedTarget) => Promise<ClientConversation[]>
  readLatestPage: (target: AuthenticatedTarget, id: string, limit: number) => Promise<ClientMessageList>
}

export function createMessageBootstrap(
  dependencies: MessageBootstrapDependencies,
  timeoutMs = MESSAGE_BOOTSTRAP_TIMEOUT_MS,
  completedFlightRetentionMs = 1_000
) {
  const flights = new Map<string, Promise<ReadonlyMap<string, ClientMessageList>>>()
  return (target: AuthenticatedTarget, onPage?: (id: string, page: ClientMessageList) => void) => {
    const key = JSON.stringify([target.id, target.url, target.userId])
    const existing = flights.get(key)
    if (existing) return existing
    const results = new Map<string, ClientMessageList>()
    const work = hydrateLocal(target, dependencies, results, onPage)
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

async function hydrateLocal(
  target: AuthenticatedTarget,
  dependencies: MessageBootstrapDependencies,
  results: Map<string, ClientMessageList>,
  onPage?: (id: string, page: ClientMessageList) => void
) {
  // Network catch-up belongs to the realtime provider; startup only hydrates local data.
  const startedAt = performance.now()
  let count = 0
  let loaded = 0
  traceMobileStartup("bootstrap.local.start")
  try {
    const conversations = await dependencies.listLocalConversations(target)
    count = conversations.length
    if (process.env.EXPO_PUBLIC_MOBILE_PERF === "1" && process.env.EXPO_PUBLIC_MOBILE_SKIP_HISTORY_WARMUP === "1") {
      traceMobileStartup("bootstrap.local.skipped", { count })
      return
    }
    let next = 0
    await Promise.all(Array.from({ length: Math.min(MESSAGE_BOOTSTRAP_LOCAL_CONCURRENCY, count) }, async () => {
      while (next < conversations.length) {
        const conversation = conversations[next++]!
        await dependencies.readLatestPage(target, conversation.id, MESSAGE_BOOTSTRAP_MESSAGE_LIMIT)
          .then((page) => {
            loaded += page.messages.length
            if (page.messages.length > 0) {
              results.set(conversation.id, page)
              onPage?.(conversation.id, page)
            }
          })
          .catch(() => undefined)
      }
    }))
    traceMobileStartup("bootstrap.local.ready", { count, loaded, elapsedMs: performance.now() - startedAt })
  } catch {
    traceMobileStartup("bootstrap.local.failed", { failures: 1, elapsedMs: performance.now() - startedAt })
  }
}

function withTimeout<T>(work: Promise<void>, result: T, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => resolve(result), timeoutMs)
    void work.then(
      () => { clearTimeout(timeout); resolve(result) },
      (error) => { clearTimeout(timeout); reject(error) }
    )
  })
}
