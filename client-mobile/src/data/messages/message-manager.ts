import {
  fetchConversationMessageChoiceSnapshots,
  fetchConversationMessageReactionSnapshots,
  forwardConversationMessages,
  markConversationRead,
  revokeConversationMessage,
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationTextMessage,
  sendConversationVideoMessage,
  sendConversationVoiceMessage,
  setConversationMessageReaction,
  submitConversationMessageChoiceResponse,
} from "@/data/messages/messages-api"
import {
  getMessageSyncState,
  listMessageSyncStates,
  persistMessageChoiceEvent,
  persistMessageChoiceSnapshot,
  persistMessageReactionsEvent,
  persistMessageReactionSnapshot,
  removeConversationMessageCache,
  removeServerMessageCache,
  updatePersistedMessage,
} from "@/data/messages/message-cache-store"
import { clearGlobalMessageCache, getGlobalMessageCacheSize } from "@/data/messages/message-cache-database"
import { publishConversationMessagesChanged } from "@/data/messages/message-events"
import {
  createMessageTombstoneStore,
} from "@/data/messages/message-tombstones"
import { messageRepository } from "@/data/messages/message-repository"
import {
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
} from "@/domain/messages/message-choices"
import {
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
  preserveNewerMessageState,
} from "@/domain/messages/message-reactions"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"
import { reportMessageCacheError } from "@/data/messages/message-cache-observability"

import { createMessageManager } from "@/data/messages/message-manager-core"
import type { MessageManagerDependencies } from "@/data/messages/message-manager-core"

const defaultApi = {
  fetchChoiceSnapshots: fetchConversationMessageChoiceSnapshots,
  fetchReactionSnapshots: fetchConversationMessageReactionSnapshots,
  forwardMessages: forwardConversationMessages,
  markRead: markConversationRead,
  revokeMessage: revokeConversationMessage,
  sendFile: sendConversationFileMessage,
  sendImage: sendConversationImageMessage,
  sendText: sendConversationTextMessage,
  sendVideo: sendConversationVideoMessage,
  sendVoice: sendConversationVoiceMessage,
  setReaction: setConversationMessageReaction,
  submitChoice: submitConversationMessageChoiceResponse,
}

export { createMessageManager }
export type { MessageManagerDependencies }

/** Shared production instance. All existing imports use this single state owner. */
export const messageManager = createMessageManager({
  repository: messageRepository,
  api: defaultApi,
  events: { publishConversationMessagesChanged },
  telemetry: { reportMessageCacheError },
  clearGlobalCache: clearGlobalMessageCache,
  getGlobalCacheSize: getGlobalMessageCacheSize,
  createMessageTombstoneStore,
  getMessageSyncState,
  listMessageSyncStates,
  persistMessageChoiceEvent,
  persistMessageChoiceSnapshot,
  persistMessageReactionsEvent,
  persistMessageReactionSnapshot,
  removeConversationMessageCache,
  removeServerMessageCache,
  updatePersistedMessage,
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
  applyMessageReactionsUpdate,
  applyMessageReactionSnapshot,
  preserveNewerMessageState,
  formatClientMessageBodySummary,
} satisfies MessageManagerDependencies)
