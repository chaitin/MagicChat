import type { ClientMessage, MessageChoiceSnapshot } from "@/core/models"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"

type ChoiceMessageTombstoneStatus = "deleted" | "revoked"

export function createMessageTombstoneStore() {
const choiceMessageTombstones = new Map<
  string,
  Map<string, ChoiceMessageTombstoneStatus>
>()

function recordChoiceMessageTombstone(
  target: AuthenticatedTarget,
  snapshot: MessageChoiceSnapshot
) {
  if (snapshot.status !== "deleted" && snapshot.status !== "revoked") return

  const key = createConversationKey(target, snapshot.conversationId)
  const conversation = choiceMessageTombstones.get(key) ?? new Map()
  const current = conversation.get(snapshot.messageId)
  if (current !== "deleted") {
    conversation.set(snapshot.messageId, snapshot.status)
  }
  choiceMessageTombstones.set(key, conversation)
}

function applyChoiceMessageTombstone(
  target: AuthenticatedTarget,
  message: ClientMessage
): ClientMessage | null {
  const status = choiceMessageTombstones
    .get(createConversationKey(target, message.conversationId))
    ?.get(message.id)
  if (status === "deleted") return null
  if (status !== "revoked") return message

  return {
    ...message,
    body: { type: "revoked" },
    choice: undefined,
    reactions: [],
  }
}

function clearAllMessageTombstones() {
  choiceMessageTombstones.clear()
}

function clearConversationMessageTombstones(
  target: AuthenticatedTarget,
  conversationId: string
) {
  choiceMessageTombstones.delete(createConversationKey(target, conversationId))
}

function clearServerMessageTombstones(server: ServerTarget) {
  for (const key of choiceMessageTombstones.keys()) {
    if (conversationKeyBelongsToServer(key, server)) {
      choiceMessageTombstones.delete(key)
    }
  }
}


return { applyChoiceMessageTombstone, clearAllMessageTombstones, clearConversationMessageTombstones, clearServerMessageTombstones, recordChoiceMessageTombstone }
}

const defaultStore = createMessageTombstoneStore()
export const { applyChoiceMessageTombstone, clearAllMessageTombstones, clearConversationMessageTombstones, clearServerMessageTombstones, recordChoiceMessageTombstone } = defaultStore

function createConversationKey(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return JSON.stringify([
    target.id,
    target.url,
    target.userId,
    conversationId,
  ])
}

function conversationKeyBelongsToServer(key: string, server: ServerTarget) {
  try {
    const value: unknown = JSON.parse(key)
    return (
      Array.isArray(value) &&
      value[0] === server.id &&
      value[1] === server.url
    )
  } catch {
    return false
  }
}
