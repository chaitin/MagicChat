import type { QueryClient } from "@tanstack/react-query"

import { messageManager } from "@/data/messages"
import {
  normalizeMessageReactionUsers,
  normalizeReactionVersion,
} from "@/data/messages/message-normalizer"
import type { MessageReactionsUpdatedEvent } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"

const REACTION_SNAPSHOT_BATCH_SIZE = 100
const MAX_REACTION_SNAPSHOT_CATCH_UP_ATTEMPTS = 3

export async function applyRealtimeMessageReactionsEvent(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  payload: unknown
) {
  const event = normalizeMessageReactionsUpdatedPayload(payload)
  const status = await messageManager.applyReactionEvent(server, event)

  if (status === "gap") {
    await synchronizeConversationMessageReactions(
      queryClient,
      server,
      event.conversationId,
      [event.messageId],
      new Map([[event.messageId, event.reactionVersion]])
    )
  }
}

export async function synchronizeConversationMessageReactions(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  conversationId: string,
  rawMessageIds: string[],
  minimumVersions: ReadonlyMap<string, number> = new Map()
) {
  const messageIds = [...new Set(rawMessageIds)]

  for (
    let index = 0;
    index < messageIds.length;
    index += REACTION_SNAPSHOT_BATCH_SIZE
  ) {
    let pending = messageIds.slice(
      index,
      index + REACTION_SNAPSHOT_BATCH_SIZE
    )

    for (
      let attempt = 0;
      pending.length > 0 &&
      attempt < MAX_REACTION_SNAPSHOT_CATCH_UP_ATTEMPTS;
      attempt += 1
    ) {
      const snapshots = await messageManager.fetchReactionSnapshots(
        server,
        conversationId,
        pending
      )
      const versions = new Map<string, number>()

      for (const snapshot of snapshots) {
        versions.set(snapshot.messageId, snapshot.reactionVersion)
        await messageManager.applyReactionSnapshot(server, snapshot)
      }

      pending = pending.filter(
        (messageId) =>
          (versions.get(messageId) ?? -1) <
          (minimumVersions.get(messageId) ?? 0)
      )
    }

    if (pending.length > 0) {
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(server, conversationId),
      })
    }
  }
}

function normalizeMessageReactionsUpdatedPayload(
  payload: unknown
): MessageReactionsUpdatedEvent {
  const value = asRecord(payload)
  if (
    !value ||
    typeof value.actor_reacted !== "boolean" ||
    typeof value.actor_text !== "string" ||
    value.actor_text.length === 0 ||
    typeof value.actor_user_id !== "string" ||
    value.actor_user_id.length === 0 ||
    typeof value.conversation_id !== "string" ||
    value.conversation_id.length === 0 ||
    typeof value.message_id !== "string" ||
    value.message_id.length === 0 ||
    !Number.isSafeInteger(value.reaction_version) ||
    (value.reaction_version as number) < 0 ||
    !Array.isArray(value.reactions)
  ) {
    throw new Error("实时消息表情格式不正确")
  }

  return {
    actorReacted: value.actor_reacted,
    actorText: value.actor_text,
    actorUserId: value.actor_user_id,
    conversationId: value.conversation_id,
    messageId: value.message_id,
    reactionVersion: normalizeReactionVersion(value.reaction_version),
    reactions: value.reactions.map((candidate) => {
      const reaction = asRecord(candidate)
      if (
        !reaction ||
        typeof reaction.text !== "string" ||
        reaction.text.length === 0 ||
        !Number.isSafeInteger(reaction.count) ||
        (reaction.count as number) <= 0
      ) {
        throw new Error("实时消息表情格式不正确")
      }
      return {
        count: reaction.count as number,
        text: reaction.text,
        users: normalizeMessageReactionUsers(reaction.users),
      }
    }),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
