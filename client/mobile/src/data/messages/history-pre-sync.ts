import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { messageManager } from "@/data/messages/message-manager"
import {
  preSyncRecentConversationHistory as coordinateHistoryPreSync,
  type HistoryPreSyncDependencies,
} from "@/domain/messages/history-pre-sync"

const dependencies: HistoryPreSyncDependencies = {
  catchUpAfter: (...args) => messageManager.catchUpAfter(...args),
  getSyncState: (...args) => messageManager.getSyncState(...args),
  loadMessagePage: (...args) => messageManager.loadMessagePage(...args),
  synchronizeLatest: (...args) => messageManager.synchronizeLatest(...args),
}

export function preSyncRecentConversationHistory(
  target: AuthenticatedTarget,
  conversations: ClientConversation[]
) {
  return coordinateHistoryPreSync(target, conversations, dependencies)
}
