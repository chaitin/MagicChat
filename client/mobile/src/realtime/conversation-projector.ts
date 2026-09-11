import type { QueryClient } from "@tanstack/react-query"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { queryKeys } from "@/data/query"
import { realtimeEvents } from "./realtime-protocol"
import { normalizeConversationChoiceReceivedPayload, normalizeConversationMentionedPayload, normalizeConversationMuteUpdatedPayload, normalizeConversationPinUpdatedPayload, normalizeConversationRemovedPayload } from "./realtime-payload"

export async function projectRealtimeConversationEvent(queryClient: QueryClient, server: AuthenticatedTarget, event: string, payload: unknown) {
  if (event === realtimeEvents.conversationRemoved) {
    const id = normalizeConversationRemovedPayload(payload)
    await conversationManager.remove(server, id)
    queryClient.removeQueries({ exact: true, queryKey: queryKeys.conversationMessages(server, id) })
    await messageManager.clearConversation(server, id)
    return true
  }
  let id: string
  let updated
  if (event === realtimeEvents.conversationMemberMentioned) {
    const value = normalizeConversationMentionedPayload(payload); id = value.conversationId
    updated = await conversationManager.patch(server, id, (item) => ({ lastMentionedSeq: Math.max(item.lastMentionedSeq, value.lastMentionedSeq) }))
  } else if (event === realtimeEvents.conversationMemberChoiceReceived) {
    const value = normalizeConversationChoiceReceivedPayload(payload); id = value.conversationId
    updated = await conversationManager.patch(server, id, (item) => ({ lastChoiceSeq: Math.max(item.lastChoiceSeq, value.lastChoiceSeq) }))
  } else if (event === realtimeEvents.conversationPinUpdated) {
    const value = normalizeConversationPinUpdatedPayload(payload); id = value.conversationId
    updated = await conversationManager.patch(server, id, { pinned: value.pinned })
  } else if (event === realtimeEvents.conversationMuteUpdated) {
    const value = normalizeConversationMuteUpdatedPayload(payload); id = value.conversationId
    updated = await conversationManager.patch(server, id, { notificationMuted: value.muted })
  } else return false
  if (!updated) void conversationManager.refresh(server).catch(() => undefined)
  return true
}
