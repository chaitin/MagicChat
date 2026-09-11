import type {
  ClientChoiceMessageBody,
  ClientConversation,
  ClientMessage,
  ClientMessageChoiceState,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
} from "@/core/models"

export function isMessageChoiceAnswered(
  choice: ClientMessageChoiceState | undefined
) {
  return Boolean(choice?.myOptionIds.length)
}

export function updateMessageChoiceDraft(
  body: ClientChoiceMessageBody,
  current: string[],
  optionId: string
) {
  if (!body.options.some((option) => option.id === optionId)) return current
  if (body.selection === "single") return [optionId]

  return current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : body.options
        .map((option) => option.id)
        .filter((id) => id === optionId || current.includes(id))
}

export function shouldShowMessageChoiceResponseCounts(
  conversation: ClientConversation
) {
  return (
    conversation.type === "group" ||
    conversation.topic?.parentConversationType === "group"
  )
}

export function isMessageChoiceStateValidForBody(
  body: ClientChoiceMessageBody,
  choice: ClientMessageChoiceState
) {
  const optionIds = body.options.map((option) => option.id)
  const optionIdSet = new Set(optionIds)
  const stateOptionIds = choice.options.map((option) => option.id)
  return (
    optionIdSet.size === optionIds.length &&
    stateOptionIds.length === optionIds.length &&
    new Set(stateOptionIds).size === stateOptionIds.length &&
    stateOptionIds.every((id) => optionIdSet.has(id)) &&
    new Set(choice.myOptionIds).size === choice.myOptionIds.length &&
    choice.myOptionIds.every((id) => optionIdSet.has(id)) &&
    (body.selection === "multiple" || choice.myOptionIds.length <= 1)
  )
}

export function applyMessageChoiceState(
  message: ClientMessage,
  incoming: ClientMessageChoiceState
) {
  if (
    message.body.type !== "choice" ||
    !isChoiceStateValidForMessage(message, incoming)
  ) {
    return message
  }

  const previous = message.choice
  if (!previous || !isChoiceStateValidForMessage(message, previous)) {
    return { ...message, choice: cloneChoiceState(incoming) }
  }

  const incomingIsNewer = incoming.responseCount >= previous.responseCount
  const counts = incomingIsNewer ? incoming : previous
  const previousCounts = new Map(
    previous.options.map((option) => [option.id, option.responseCount])
  )
  const myOptionIds =
    incoming.myOptionIds.length > 0
      ? incoming.myOptionIds
      : previous.myOptionIds
  const choice: ClientMessageChoiceState = {
    myOptionIds: [...myOptionIds],
    options: counts.options.map((option) => ({
      id: option.id,
      responseCount: Math.max(
        option.responseCount,
        previousCounts.get(option.id) ?? 0
      ),
    })),
    responseCount: Math.max(previous.responseCount, incoming.responseCount),
  }

  if (areChoiceStatesEqual(previous, choice)) return message
  return { ...message, choice }
}

export function applyMessageChoiceEvent(
  message: ClientMessage,
  event: MessageChoiceUpdatedEvent,
  currentUserId: string
) {
  if (
    message.id !== event.messageId ||
    message.conversationId !== event.conversationId
  ) {
    return message
  }
  return applyMessageChoiceState(message, {
    ...event.choice,
    myOptionIds:
      event.actorUserId === currentUserId
        ? event.actorOptionIds
        : (message.choice?.myOptionIds ?? []),
  })
}

export function applyMessageChoiceSnapshot(
  message: ClientMessage,
  snapshot: MessageChoiceSnapshot
): ClientMessage | null {
  if (
    message.id !== snapshot.messageId ||
    message.conversationId !== snapshot.conversationId
  ) {
    return message
  }
  if (snapshot.status === "deleted") return null
  if (snapshot.status === "revoked") {
    return {
      ...message,
      body: { type: "revoked" },
      choice: undefined,
      reactions: [],
    }
  }
  return snapshot.choice
    ? applyMessageChoiceState(message, snapshot.choice)
    : message
}

export function preserveNewerMessageChoiceState(
  current: ClientMessage,
  incoming: ClientMessage
) {
  if (
    current.body.type !== "choice" ||
    incoming.body.type !== "choice" ||
    !current.choice
  ) {
    return incoming
  }
  return applyMessageChoiceState(incoming, current.choice)
}

function isChoiceStateValidForMessage(
  message: ClientMessage,
  choice: ClientMessageChoiceState
) {
  if (message.body.type !== "choice") return false
  return isMessageChoiceStateValidForBody(message.body, choice)
}

function cloneChoiceState(choice: ClientMessageChoiceState) {
  return {
    myOptionIds: [...choice.myOptionIds],
    options: choice.options.map((option) => ({ ...option })),
    responseCount: choice.responseCount,
  }
}

function areChoiceStatesEqual(
  left: ClientMessageChoiceState,
  right: ClientMessageChoiceState
) {
  return (
    left.responseCount === right.responseCount &&
    left.myOptionIds.length === right.myOptionIds.length &&
    left.myOptionIds.every((id, index) => id === right.myOptionIds[index]) &&
    left.options.length === right.options.length &&
    left.options.every(
      (option, index) =>
        option.id === right.options[index]?.id &&
        option.responseCount === right.options[index]?.responseCount
    )
  )
}
