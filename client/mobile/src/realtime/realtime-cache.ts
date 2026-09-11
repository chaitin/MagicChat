import type { QueryClient } from "@tanstack/react-query"
import type { ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { contactManager } from "@/data/contacts"
import { conversationManager } from "@/data/conversations"
import { queryKeys } from "@/data/query"
import { applyRealtimeMessageChoiceEvent } from "./choice-sync"
import { projectRealtimeConversationEvent } from "./conversation-projector"
import { projectRealtimeMessage } from "./message-projector"
import { applyRealtimeMessageReactionsEvent } from "./reaction-sync"
import { realtimeEvents } from "./realtime-protocol"
import { projectRealtimeTopicEvent } from "./topic-projector"

export { refreshClientDataOnForeground, synchronizeRealtimeData } from "./realtime-sync"

/** Compatibility facade routing protocol events to domain projectors. */
export async function applyRealtimeEvent(queryClient: QueryClient, server: AuthenticatedTarget, event: string, payload: unknown, options: { activeConversationId?: string; visible?: boolean; isCurrent?: () => boolean } = {}): Promise<{ message?: ClientMessage; notificationMuted?: boolean }> {
  const isCurrent = options.isCurrent ?? (() => true)
  if (!isCurrent()) return {}
  if (event === realtimeEvents.userNicknamePolicyUpdated) {
    const contacts = await contactManager.getSnapshot(server)
    await Promise.all([
      contactManager.refreshUsers(server, Object.keys(contacts.usersById)),
      conversationManager.refresh(server),
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.currentUser(server),
      }),
    ])
    return {}
  }
  if (event === realtimeEvents.messageCreated || event === realtimeEvents.messageUpdated) {
    return projectRealtimeMessage(server, payload, {
      markReadConversationId:
        event === realtimeEvents.messageCreated && options.visible
          ? options.activeConversationId
          : undefined,
      received: event === realtimeEvents.messageCreated,
    })
  }
  if (event === realtimeEvents.messageReactionsUpdated) {
    await applyRealtimeMessageReactionsEvent(queryClient, server, payload)
    return {}
  }
  if (event === realtimeEvents.messageChoiceUpdated) {
    await applyRealtimeMessageChoiceEvent(queryClient, server, payload)
    return {}
  }
  if (await projectRealtimeConversationEvent(queryClient, server, event, payload)) return {}
  if (event === realtimeEvents.topicCreated || event === realtimeEvents.topicParticipated || event === realtimeEvents.topicArchived) {
    await projectRealtimeTopicEvent(queryClient, server, payload)
  }
  return {}
}
