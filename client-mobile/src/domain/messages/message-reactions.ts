import type {
  ClientMessage,
  MessageReactionsUpdatedEvent,
  MessageReactionSnapshot,
} from "@/data/models"

export type ReactionUpdateResult = {
  message: ClientMessage
  status: "applied" | "gap" | "stale"
}

export function preserveNewerMessageReactionState(
  current: ClientMessage,
  incoming: ClientMessage
) {
  return current.reactionVersion > incoming.reactionVersion
    ? {
        ...incoming,
        reactionVersion: current.reactionVersion,
        reactions: current.reactions,
      }
    : incoming
}

export function applyMessageReactionSnapshot(
  message: ClientMessage,
  snapshot: MessageReactionSnapshot
) {
  if (
    message.id !== snapshot.messageId ||
    message.conversationId !== snapshot.conversationId ||
    message.body.type === "revoked" ||
    message.reactionVersion > snapshot.reactionVersion
  ) {
    return message
  }

  return {
    ...message,
    reactionVersion: snapshot.reactionVersion,
    reactions: snapshot.reactions,
  }
}

export function applyMessageReactionsUpdate(
  message: ClientMessage,
  event: MessageReactionsUpdatedEvent,
  currentUserId: string
): ReactionUpdateResult {
  if (
    message.id !== event.messageId ||
    message.conversationId !== event.conversationId ||
    message.body.type === "revoked" ||
    message.reactionVersion >= event.reactionVersion
  ) {
    return { message, status: "stale" }
  }
  if (event.reactionVersion > message.reactionVersion + 1) {
    return { message, status: "gap" }
  }

  const previousByText = new Map(
    message.reactions.map((reaction) => [reaction.text, reaction])
  )
  return {
    message: {
      ...message,
      reactionVersion: event.reactionVersion,
      reactions: event.reactions.map((reaction) => ({
        ...reaction,
        reactedByMe:
          event.actorUserId === currentUserId &&
          event.actorText === reaction.text
            ? event.actorReacted
            : (previousByText.get(reaction.text)?.reactedByMe ?? false),
      })),
    },
    status: "applied",
  }
}
