import type { QueryClient } from "@tanstack/react-query"
import type { ClientTopicDetail } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { queryKeys } from "@/data/query"
import { normalizeTopicEventPayload } from "./realtime-payload"

export async function projectRealtimeTopicEvent(queryClient: QueryClient, server: AuthenticatedTarget, payload: unknown) {
  const topic = normalizeTopicEventPayload(payload)
  await messageManager.updateMessageTopic(server, topic)
  queryClient.setQueryData<ClientTopicDetail>(queryKeys.conversationTopic(server, topic.conversationId), (current) => current ? { ...current, canArchive: topic.archived ? false : current.canArchive, canParticipate: topic.archived ? false : current.canParticipate, conversation: current.conversation.topic ? { ...current.conversation, topic: { ...current.conversation.topic, archived: topic.archived } } : current.conversation } : current)
  const conversation = await conversationManager.get(server, topic.conversationId)
  if (conversation?.topic) await conversationManager.patch(server, topic.conversationId, { topic: { ...conversation.topic, archived: topic.archived, participating: topic.archived ? conversation.topic.participating : true } })
  else void conversationManager.refresh(server).catch(() => undefined)
}
