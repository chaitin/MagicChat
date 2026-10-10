import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { MessageSyncState } from "@/data/messages/message-cache-store"

export const MAX_AUTO_MESSAGES_PER_CONVERSATION = 100
export const MAX_AUTO_MESSAGES_PER_ROUND = 100
export const AUTO_MESSAGE_PAGE_SIZE = 20

export type MessageSyncDecision =
  | { type: "skip" }
  | { type: "latest" }
  | { type: "after"; afterSeq: number; targetSeq: number }

/** One budget is shared by every automatic message request in a synchronization round. */
export async function catchUpMessagesTo(
  target: AuthenticatedTarget,
  conversationId: string,
  initialAfterSeq: number,
  targetSeq: number,
  fetchPage: (target: AuthenticatedTarget, conversationId: string, afterSeq: number, limit: number) => Promise<{ committedSeq: number; result: { page: { hasMoreAfter: boolean } } }>
) {
  let afterSeq = initialAfterSeq
  let pages = 0
  while (afterSeq < targetSeq && pages < MAX_AUTO_MESSAGES_PER_CONVERSATION / AUTO_MESSAGE_PAGE_SIZE) {
    const { committedSeq, result } = await fetchPage(target, conversationId, afterSeq, AUTO_MESSAGE_PAGE_SIZE)
    if (committedSeq <= afterSeq) {
      if (!result.page.hasMoreAfter) return
      throw new Error("消息增量同步游标没有向前推进")
    }
    afterSeq = committedSeq
    pages += 1
    if (!result.page.hasMoreAfter) return
  }
}

export function createMessageSyncBudget(limit = MAX_AUTO_MESSAGES_PER_ROUND) {
  let remaining = limit
  return {
    decide(conversation: ClientConversation, state: Pick<MessageSyncState, "httpSyncedThroughSeq"> | undefined): MessageSyncDecision {
      const latest = conversation.lastMessageSeq
      if (!Number.isSafeInteger(latest) || latest <= 0) return { type: "skip" }
      const cursor = state?.httpSyncedThroughSeq ?? 0
      if (cursor > 0 && latest <= cursor) return { type: "skip" }
      if (cursor <= 0) {
        const expected = Math.min(latest, AUTO_MESSAGE_PAGE_SIZE)
        if (latest > MAX_AUTO_MESSAGES_PER_CONVERSATION || remaining < expected) return { type: "skip" }
        remaining -= expected
        return { type: "latest" }
      }
      const missing = latest - cursor
      if (missing > MAX_AUTO_MESSAGES_PER_CONVERSATION || missing > remaining) return { type: "skip" }
      remaining -= missing
      return { type: "after", afterSeq: cursor, targetSeq: latest }
    },
  }
}
