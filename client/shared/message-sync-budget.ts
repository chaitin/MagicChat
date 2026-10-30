export const MAX_AUTO_CONVERSATIONS_PER_ROUND = 30
export const AUTO_MESSAGE_SYNC_CONCURRENCY = 3
export const MAX_AUTO_MESSAGES_PER_CONVERSATION = 100
export const MAX_AUTO_MESSAGES_PER_ROUND = 100
export const AUTO_MESSAGE_PAGE_SIZE = 20

export type MessageSyncDecision =
  | { type: "skip" }
  | { type: "latest"; limit: number }
  | { type: "after"; afterSeq: number; targetSeq: number }

type Conversation = { id: string; unreadCount: number; lastMessageSeq?: number }

/** One budget is shared by every automatic message request in a synchronization round.
 * Reserve the entire gap before starting a request; large histories stay on demand.
 */
export function createMessageSyncBudget(limit = MAX_AUTO_MESSAGES_PER_ROUND) {
  let remaining = limit
  return {
    decide(conversation: Pick<Conversation, "lastMessageSeq">, state: { httpSyncedThroughSeq: number } | undefined): MessageSyncDecision {
      const latest = conversation.lastMessageSeq ?? 0
      if (!Number.isSafeInteger(latest) || latest <= 0) return { type: "skip" }
      const cursor = state?.httpSyncedThroughSeq ?? 0
      if (cursor > 0 && latest <= cursor) return { type: "skip" }
      if (cursor <= 0) {
        const expected = Math.min(latest, AUTO_MESSAGE_PAGE_SIZE)
        if (latest > MAX_AUTO_MESSAGES_PER_CONVERSATION || remaining < expected) return { type: "skip" }
        remaining -= expected
        return { type: "latest", limit: expected }
      }
      const missing = latest - cursor
      if (missing > MAX_AUTO_MESSAGES_PER_CONVERSATION || missing > remaining) return { type: "skip" }
      remaining -= missing
      return { type: "after", afterSeq: cursor, targetSeq: latest }
    },
  }
}

export function selectAutomaticConversations<T extends Conversation>(conversations: readonly T[], activeConversationId?: string) {
  return [...conversations]
    .sort((left, right) =>
      Number(right.id === activeConversationId) - Number(left.id === activeConversationId) ||
      Number(right.unreadCount > 0) - Number(left.unreadCount > 0)
    )
    .slice(0, MAX_AUTO_CONVERSATIONS_PER_ROUND)
}

export async function runAutomaticMessageJobs<T>(jobs: readonly T[], run: (job: T) => unknown | Promise<unknown>) {
  let next = 0
  const errors: unknown[] = []
  await Promise.all(Array.from({ length: Math.min(AUTO_MESSAGE_SYNC_CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!
      try { await run(job) } catch (error) { errors.push(error) }
    }
  }))
  if (errors.length) throw errors[0]
}
