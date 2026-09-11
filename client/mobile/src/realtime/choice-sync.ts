import type { QueryClient } from "@tanstack/react-query"

import { normalizeMessageChoiceState } from "@/data/messages/message-normalizer"
import { messageManager } from "@/data/messages"
import { applyConversationMessagesChangedEvent } from "@/data/messages/message-query-cache"
import type { MessageChoiceUpdatedEvent } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"

const CHOICE_SNAPSHOT_BATCH_SIZE = 100

export async function applyRealtimeMessageChoiceEvent(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  payload: unknown
) {
  const event = normalizeMessageChoiceUpdatedPayload(payload)
  await messageManager.applyChoiceEvent(server, event)
  applyConversationMessagesChangedEvent(
    queryClient,
    server,
    event.conversationId,
    { event, type: "choice-event" }
  )
}

export async function synchronizeConversationMessageChoices(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  conversationId: string,
  rawMessageIds: string[]
) {
  const messageIds = [...new Set(rawMessageIds)]
  for (let index = 0; index < messageIds.length; index += CHOICE_SNAPSHOT_BATCH_SIZE) {
    const snapshots = await messageManager.fetchChoiceSnapshots(
      server,
      conversationId,
      messageIds.slice(index, index + CHOICE_SNAPSHOT_BATCH_SIZE)
    )
    for (const snapshot of snapshots) {
      await messageManager.applyChoiceSnapshot(server, snapshot)
      applyConversationMessagesChangedEvent(
        queryClient,
        server,
        conversationId,
        { snapshot, type: "choice-snapshot" }
      )
    }
  }
}

export function normalizeMessageChoiceUpdatedPayload(
  payload: unknown
): MessageChoiceUpdatedEvent {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.actor_user_id !== "string" ||
    value.actor_user_id.length === 0 ||
    !Array.isArray(value.actor_option_ids) ||
    !value.actor_option_ids.every(
      (optionId) => typeof optionId === "string" && optionId.length > 0
    ) ||
    new Set(value.actor_option_ids).size !== value.actor_option_ids.length ||
    typeof value.conversation_id !== "string" ||
    value.conversation_id.length === 0 ||
    typeof value.message_id !== "string" ||
    value.message_id.length === 0
  ) {
    throw new Error("选择消息更新推送格式不正确")
  }

  return {
    actorOptionIds: [...value.actor_option_ids],
    actorUserId: value.actor_user_id,
    choice: normalizeMessageChoiceState(value.choice),
    conversationId: value.conversation_id,
    messageId: value.message_id,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
