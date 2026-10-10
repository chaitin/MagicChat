import type { AuthenticatedTarget } from "@/core/server-target"
import { isUnauthorizedError } from "@/data/api-client"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { createMessageBootstrap } from "@/features/bootstrap/message-bootstrap"

const run = createMessageBootstrap({
  listLocalConversations: (target) => conversationManager.list(target),
  refreshConversations: async (target) => (await conversationManager.refreshSnapshot(target)).snapshot,
  synchronizeLatest: (target, conversationId, limit) =>
    messageManager.synchronizeLatest(target, conversationId, limit),
  readLatestPage: (target, conversationId, limit) =>
    messageManager.readLatestPage(target, conversationId, limit),
  listSyncStates: (target) => messageManager.listSyncStates(target),
  catchUpAfter: (target, conversationId, afterSeq, limit) =>
    messageManager.catchUpAfter(target, conversationId, afterSeq, limit),
  isUnauthorizedError,
})

export function runClientMessageBootstrap(
  target: AuthenticatedTarget,
  onPage?: Parameters<typeof run>[1]
) {
  return run(target, onPage)
}
