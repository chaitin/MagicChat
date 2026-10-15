import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { createAuthenticatedScopeKey } from "@/data/server-key"
import { traceMobileStartup } from "@/diagnostics/mobile-startup"
import {
  AUTO_MESSAGE_PAGE_SIZE,
  AUTO_MESSAGE_SYNC_CONCURRENCY,
  catchUpMessagesTo,
  createMessageSyncBudget,
  selectAutomaticConversations,
  type MessageSyncDecision,
} from "@/domain/messages/message-sync-budget"

export type AutomaticMessageSyncDependencies = {
  refreshConversations: (target: AuthenticatedTarget) => Promise<ClientConversation[]>
  listSyncStates: (target: AuthenticatedTarget) => Promise<{ conversationId: string; httpSyncedThroughSeq: number }[]>
  synchronizeLatest: (target: AuthenticatedTarget, id: string, limit: number) => Promise<ClientMessageList>
  catchUpAfter: (target: AuthenticatedTarget, id: string, after: number, limit: number) => Promise<{ committedSeq: number; result: ClientMessageList }>
  isUnauthorizedError: (error: unknown) => boolean
}

type SyncOptions = {
  freshSnapshot?: boolean
  activeConversationId?: string
  getCachedSeq?: (conversationId: string) => number
}

type Job = { id: string; decision: MessageSyncDecision; done: boolean }
export type AutomaticMessageSyncRound = () => Promise<void>
type Round = { run: AutomaticMessageSyncRound; configure: (options: SyncOptions) => void }

/** Shares overlapping refresh work while preserving each round's retry checkpoints. */
export function createAutomaticMessageSynchronizer(dependencies: AutomaticMessageSyncDependencies) {
  const running = new Map<string, Round>()

  return (target: AuthenticatedTarget, options: SyncOptions = {}): AutomaticMessageSyncRound => {
    const key = JSON.stringify(createAuthenticatedScopeKey(target))
    let round: Round | undefined
    return () => {
      round ??= options.freshSnapshot
        ? createRound(target, key, running.get(key))
        : running.get(key) ?? createRound(target, key)
      round.configure(options)
      return round.run()
    }
  }

  function createRound(target: AuthenticatedTarget, key: string, previousRound?: Round): Round {
    let activeConversationId: string | undefined
    let getCachedSeq: SyncOptions["getCachedSeq"]
    let jobs: Job[] | undefined
    let flight: Promise<void> | undefined
    let completed = false

    const round: Round = {
      configure(options) {
        if (!jobs) {
          activeConversationId = options.activeConversationId ?? activeConversationId
          getCachedSeq = options.getCachedSeq ?? getCachedSeq
        }
      },
      run() {
        if (completed) return Promise.resolve()
        if (flight) return flight
        flight = execute().then(() => {
          completed = true
        }).finally(() => {
          flight = undefined
          if (running.get(key) === round) running.delete(key)
        })
        running.set(key, round)
        return flight
      },
    }

    async function execute() {
      // A new transport must fetch a snapshot after subscribing, not reuse a pre-disconnect snapshot.
      const previous = previousRound
      previousRound = undefined
      // Earlier work may use expired credentials; this round validates its own fresh request.
      if (previous) await previous.run().catch(() => undefined)
      const startedAt = performance.now()
      let messagesStartedAt = startedAt
      if (!jobs) {
        const conversations = await dependencies.refreshConversations(target).catch((error: unknown) => {
          traceMobileStartup("sync.conversations.failed", { failures: 1, elapsedMs: performance.now() - startedAt })
          throw error
        })
        traceMobileStartup("sync.conversations.ready", { count: conversations.length, elapsedMs: performance.now() - startedAt })
        messagesStartedAt = performance.now()
        const states = await dependencies.listSyncStates(target).catch(() => [])
        const byId = new Map(states.map((state) => [state.conversationId, state]))
        const budget = createMessageSyncBudget()
        jobs = selectAutomaticConversations(conversations, activeConversationId).map((conversation) => ({
          id: conversation.id,
          decision: budget.decide(conversation, byId.get(conversation.id) ?? (
            getCachedSeq ? { httpSyncedThroughSeq: getCachedSeq(conversation.id) } : undefined
          )),
          done: false,
        })).filter((job) => job.decision.type !== "skip")
      }

      const pending = jobs.filter((job) => !job.done)
      const failures: unknown[] = []
      let next = 0
      let unauthorized = false
      await Promise.all(Array.from({ length: Math.min(AUTO_MESSAGE_SYNC_CONCURRENCY, pending.length) }, async () => {
        while (next < pending.length && !unauthorized) {
          const job = pending[next++]!
          try {
            if (job.decision.type === "after") {
              const decision = job.decision
              await catchUpMessagesTo(target, job.id, decision.afterSeq, decision.targetSeq, async (...args) => {
                const result = await dependencies.catchUpAfter(...args)
                decision.afterSeq = Math.max(decision.afterSeq, result.committedSeq)
                return result
              })
            } else if (job.decision.type === "latest") {
              await dependencies.synchronizeLatest(target, job.id, AUTO_MESSAGE_PAGE_SIZE)
            } else continue
            job.done = true
          } catch (error) {
            if (isUnavailableConversation(error)) {
              job.done = true
              continue
            }
            failures.push(error)
            if (dependencies.isUnauthorizedError(error)) unauthorized = true
          }
        }
      }))
      traceMobileStartup(failures.length ? "sync.messages.failed" : "sync.messages.ready", {
        count: pending.length, failures: failures.length, elapsedMs: performance.now() - messagesStartedAt,
      })
      if (failures.length) throw failures.find(dependencies.isUnauthorizedError) ?? failures[0]
    }

    return round
  }
}

export function isUnavailableConversation(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && (error.status === 403 || error.status === 404)
}
