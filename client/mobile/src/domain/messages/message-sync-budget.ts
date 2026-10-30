import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { flattenVisibleConversations } from "@/domain/conversations/conversation-order"

import { AUTO_MESSAGE_PAGE_SIZE, MAX_AUTO_MESSAGES_PER_CONVERSATION, selectAutomaticConversations as selectFlatConversations } from "../../../../shared/message-sync-budget"
export {
  MAX_AUTO_CONVERSATIONS_PER_ROUND,
  AUTO_MESSAGE_SYNC_CONCURRENCY,
  MAX_AUTO_MESSAGES_PER_CONVERSATION,
  MAX_AUTO_MESSAGES_PER_ROUND,
  AUTO_MESSAGE_PAGE_SIZE,
  createMessageSyncBudget,
  type MessageSyncDecision,
} from "../../../../shared/message-sync-budget"

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
    const { committedSeq, result } = await fetchPage(target, conversationId, afterSeq, Math.min(AUTO_MESSAGE_PAGE_SIZE, targetSeq - afterSeq))
    if (committedSeq <= afterSeq) {
      if (!result.page.hasMoreAfter) return
      throw new Error("消息增量同步游标没有向前推进")
    }
    afterSeq = committedSeq
    pages += 1
    if (!result.page.hasMoreAfter) return
  }
}

export function selectAutomaticConversations(conversations: ClientConversation[], activeConversationId?: string) {
  return selectFlatConversations(flattenVisibleConversations(conversations, { activeConversationId }), activeConversationId)
}
