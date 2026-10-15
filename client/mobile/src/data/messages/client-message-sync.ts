import { isUnauthorizedError } from "@/data/api-client"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { createAutomaticMessageSynchronizer } from "@/data/messages/automatic-message-sync"

export const createClientMessageSyncRound = createAutomaticMessageSynchronizer({
  refreshConversations: async (target) => (await conversationManager.refreshSnapshot(target)).snapshot,
  listSyncStates: (target) => messageManager.listSyncStates(target),
  synchronizeLatest: (target, id, limit) => messageManager.synchronizeLatest(target, id, limit),
  catchUpAfter: (target, id, after, limit) => messageManager.catchUpAfter(target, id, after, limit),
  isUnauthorizedError,
})
