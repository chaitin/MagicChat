import type { ClientMessage, ClientMessageList, ClientMessagePage, MessageChoiceSnapshot, MessageChoiceUpdatedEvent, MessageReactionsUpdatedEvent, MessageReactionSnapshot } from "@/core/models"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import type { ClientMessageUpload } from "@/data/messages/message-upload"
import type { messageRepository } from "@/data/messages/message-repository"
import type * as Api from "@/data/messages/messages-api"
import type * as Store from "@/data/messages/message-cache-store"
import type * as Database from "@/data/messages/message-cache-database"
import type * as Events from "@/data/messages/message-events"
import type * as Tombstones from "@/data/messages/message-tombstones"
import type * as Choices from "@/domain/messages/message-choices"
import type * as Reactions from "@/domain/messages/message-reactions"
import type * as Presenter from "@/domain/messages/message-presenter"
import type * as Observability from "@/data/messages/message-cache-observability"

type fetchConversationMessageChoiceSnapshots = typeof Api.fetchConversationMessageChoiceSnapshots
type fetchConversationMessageReactionSnapshots = typeof Api.fetchConversationMessageReactionSnapshots
type forwardConversationMessages = typeof Api.forwardConversationMessages
type markConversationRead = typeof Api.markConversationRead
type revokeConversationMessage = typeof Api.revokeConversationMessage
type sendConversationFileMessage = typeof Api.sendConversationFileMessage
type sendConversationImageMessage = typeof Api.sendConversationImageMessage
type sendConversationTextMessage = typeof Api.sendConversationTextMessage
type sendConversationVideoMessage = typeof Api.sendConversationVideoMessage
type sendConversationVoiceMessage = typeof Api.sendConversationVoiceMessage
type setConversationMessageReaction = typeof Api.setConversationMessageReaction
type submitConversationMessageChoiceResponse = typeof Api.submitConversationMessageChoiceResponse

type SendTextInput = {
  clientMessageId: string
  content: string
  replyToMessageId?: string
}

type SendUploadInput = {
  clientMessageId: string
  replyToMessageId?: string
}

type RuntimeConversation = Map<string, ClientMessage>

export type MessageManagerDependencies = {
  repository: typeof messageRepository
  api: {
    fetchChoiceSnapshots: fetchConversationMessageChoiceSnapshots
    fetchReactionSnapshots: fetchConversationMessageReactionSnapshots
    forwardMessages: forwardConversationMessages
    markRead: markConversationRead
    revokeMessage: revokeConversationMessage
    sendFile: sendConversationFileMessage
    sendImage: sendConversationImageMessage
    sendText: sendConversationTextMessage
    sendVideo: sendConversationVideoMessage
    sendVoice: sendConversationVoiceMessage
    setReaction: setConversationMessageReaction
    submitChoice: submitConversationMessageChoiceResponse
  }
  events: { publishConversationMessagesChanged: typeof Events.publishConversationMessagesChanged }
  telemetry: { reportMessageCacheError: typeof Observability.reportMessageCacheError }
  clearGlobalCache: typeof Database.clearGlobalMessageCache
  getGlobalCacheSize: typeof Database.getGlobalMessageCacheSize
  createMessageTombstoneStore: typeof Tombstones.createMessageTombstoneStore
  getMessageSyncState: typeof Store.getMessageSyncState
  listMessageSyncStates: typeof Store.listMessageSyncStates
  persistMessageChoiceEvent: typeof Store.persistMessageChoiceEvent
  persistMessageChoiceSnapshot: typeof Store.persistMessageChoiceSnapshot
  persistMessageReactionsEvent: typeof Store.persistMessageReactionsEvent
  persistMessageReactionSnapshot: typeof Store.persistMessageReactionSnapshot
  removeConversationMessageCache: typeof Store.removeConversationMessageCache
  removeServerMessageCache: typeof Store.removeServerMessageCache
  updatePersistedMessage: typeof Store.updatePersistedMessage
  applyMessageChoiceEvent: typeof Choices.applyMessageChoiceEvent
  applyMessageChoiceSnapshot: typeof Choices.applyMessageChoiceSnapshot
  applyMessageReactionsUpdate: typeof Reactions.applyMessageReactionsUpdate
  applyMessageReactionSnapshot: typeof Reactions.applyMessageReactionSnapshot
  preserveNewerMessageState: typeof Reactions.preserveNewerMessageState
  formatClientMessageBodySummary: typeof Presenter.formatClientMessageBodySummary
}

export function createMessageManager(dependencies: MessageManagerDependencies) {
  const { repository, api, events, telemetry, clearGlobalCache, getGlobalCacheSize } = dependencies
  const { getMessageSyncState, listMessageSyncStates, persistMessageChoiceEvent, persistMessageChoiceSnapshot, persistMessageReactionsEvent, persistMessageReactionSnapshot, removeConversationMessageCache, removeServerMessageCache, updatePersistedMessage, applyMessageChoiceEvent, applyMessageChoiceSnapshot, applyMessageReactionsUpdate, applyMessageReactionSnapshot, preserveNewerMessageState, formatClientMessageBodySummary } = dependencies
  const { applyChoiceMessageTombstone, clearAllMessageTombstones, clearConversationMessageTombstones, clearServerMessageTombstones, recordChoiceMessageTombstone } = dependencies.createMessageTombstoneStore()

const MAX_RUNTIME_MESSAGES_PER_CONVERSATION = 3_000
const runtimeMessages = new Map<string, RuntimeConversation>()
const runtimePageState = new Map<string, ClientMessagePage>()
const latestSynchronization = new Map<string, Promise<ClientMessageList>>()
const activeMessageSynchronizations = new Set<Promise<unknown>>()
const activeMessageWrites = new Set<Promise<unknown>>()
let messageCacheClearOperation: Promise<void> | null = null

function runMessageWrite<T>(
  write: () => Promise<T>,
  barrier: Promise<void> | null = messageCacheClearOperation
): Promise<T> {
  const operation = (async () => {
    await barrier
    return write()
  })()
  activeMessageWrites.add(operation)
  void operation.finally(() => activeMessageWrites.delete(operation)).catch(() => undefined)
  return operation
}

const manager = {
  clearAllOfflineMessages,
  getOfflineMessageSize: getGlobalCacheSize,
  applyChoiceEvent,
  applyChoiceSnapshot,
  applyReactionEvent,
  applyReactionSnapshot,
  catchUpAfter,
  clearConversation,
  clearServer,
  fetchChoiceSnapshots,
  fetchReactionSnapshots,
  forwardMessage,
  getSyncState: getMessageSyncState,
  listSyncStates: listMessageSyncStates,
  loadMessagePage,
  markRead,
  readLatestPage,
  revokeMessage,
  sendFile,
  sendImage,
  sendText,
  sendVideo,
  sendVoice,
  setReaction,
  submitChoice,
  synchronizeLatest,
  updateMessageTopic,
  updateTopicSourcePreview,
  writeMessages,
}

function clearAllOfflineMessages() {
  if (messageCacheClearOperation) return messageCacheClearOperation

  const operation = (async () => {
    // Synchronizations persist their HTTP result before resolving. Waiting here makes
    // cache maintenance a barrier: no response started before the clear can write back late.
    await Promise.allSettled([...activeMessageSynchronizations, ...activeMessageWrites])
    await clearGlobalCache()
    runtimeMessages.clear()
    runtimePageState.clear()
    clearAllMessageTombstones()
  })().finally(() => {
    if (messageCacheClearOperation === operation) {
      messageCacheClearOperation = null
    }
  })
  messageCacheClearOperation = operation
  return operation
}

async function readLatestPage(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessageList> {
  const cachedMessages = await repository
    .readLatestLocal(target, conversationId, limit)
    .catch((error: unknown) => {
      reportCacheFailure(target, conversationId, "latest-page-read", error)
      return []
    })
  const protectedCached = applyMessageTombstones(target, cachedMessages)
  upsertRuntimeMessages(target, protectedCached)
  const messages = mergeMessages([
    ...protectedCached,
    ...readRuntimeMessages(target, conversationId),
  ]).slice(0, limit)
  const state = runtimePageState.get(
    createRuntimeConversationKey(target, conversationId)
  )
  return createRuntimePage(messages, limit, state)
}

async function loadMessagePage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: { beforeSeq?: number; limit: number },
  options: { signal?: AbortSignal } = {}
) {
  const beforeSeq = input.beforeSeq
  if (beforeSeq === undefined) {
    return readLatestPage(target, conversationId, input.limit)
  }

  const state = await repository
    .readSyncStateLocal(target, conversationId)
    .catch((error: unknown) => {
      reportCacheFailure(target, conversationId, "before-state-read", error)
      return null
    })
  const contiguous = Boolean(
    state &&
      state.httpSyncedThroughSeq > 0 &&
      beforeSeq <= state.httpSyncedThroughSeq + 1
  )
  if (contiguous) {
    const local = await repository
      .readBeforeLocal(target, conversationId, beforeSeq, input.limit)
      .catch((error: unknown) => {
        reportCacheFailure(target, conversationId, "before-page-read", error)
        return null
      })
    if (local && (local.length > 0 || state?.hasMoreBefore === false)) {
      const messages = applyMessageTombstones(target, local)
      upsertRuntimeMessages(target, messages)
      return createCachedPage(
        messages,
        input.limit,
        local.length > 0
          ? local.length >= input.limit || state?.hasMoreBefore !== false
          : false,
        beforeSeq
      )
    }
  }

  const result = applyMessageListTombstones(
    target,
    await repository.fetchBeforeRemote(
      target,
      conversationId,
      beforeSeq,
      input.limit,
      options
    )
  )
  await runMessageWrite(() => repository.persistBefore(target, conversationId, beforeSeq, result))
    .catch((error: unknown) =>
      reportCacheFailure(target, conversationId, "before-page-write", error, result.messages.length)
    )
  upsertRuntimeMessages(target, result.messages)
  return result
}

function synchronizeLatest(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessageList> {
  const key = createRuntimeConversationKey(target, conversationId)
  const current = latestSynchronization.get(key)
  if (current) return current

  const admittedBarrier = messageCacheClearOperation
  const operation = (async () => {
    // Work admitted during maintenance starts only after the clear has completed.
    await admittedBarrier
    const result = await repository.fetchLatestRemote(
      target,
      conversationId,
      limit
    )
    await runMessageWrite(
      () => repository.persistLatest(target, conversationId, result),
      admittedBarrier
    )
      .catch((error: unknown) =>
        reportCacheFailure(target, conversationId, "latest-page-write", error, result.messages.length)
      )
    return result
  })()
    .then(async (rawResult) => {
      const result = applyMessageListTombstones(target, rawResult)
      upsertRuntimeMessages(target, result.messages)
      runtimePageState.set(key, result.page)
      events.publishConversationMessagesChanged(target, conversationId, {
        page: createLatestRuntimePage(
          target,
          conversationId,
          result,
          limit
        ),
        type: "latest-page",
      })
      return result
    })
    .finally(() => {
      if (latestSynchronization.get(key) === operation) {
        latestSynchronization.delete(key)
      }
    })
  latestSynchronization.set(key, operation)
  activeMessageSynchronizations.add(operation)
  void operation.finally(() => activeMessageSynchronizations.delete(operation)).catch(() => undefined)
  return operation
}

function catchUpAfter(
  target: AuthenticatedTarget,
  conversationId: string,
  afterSeq: number,
  limit: number
) {
  const admittedBarrier = messageCacheClearOperation
  const operation = (async () => {
    await admittedBarrier
    const rawResult = await repository.fetchAfterRemote(
      target,
      conversationId,
      afterSeq,
      limit
    )
    const result = applyMessageListTombstones(target, rawResult)
    const committedSeq = await runMessageWrite(
      () => repository.persistAfter(target, conversationId, afterSeq, result),
      admittedBarrier
    )
      .catch((error: unknown) => {
        reportCacheFailure(target, conversationId, "after-page-write", error, result.messages.length)
        return result.messages.reduce(
          (newest, message) => Math.max(newest, message.seq),
          afterSeq
        )
      })
    upsertRuntimeMessages(target, result.messages)
    events.publishConversationMessagesChanged(target, conversationId, {
      messages: result.messages,
      type: "upsert",
    })
    return { committedSeq, result }
  })()
  activeMessageSynchronizations.add(operation)
  void operation.finally(() => activeMessageSynchronizations.delete(operation)).catch(() => undefined)
  return operation
}

async function writeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  const protectedMessages = applyMessageTombstones(target, messages)
  if (protectedMessages.length === 0) return

  await runMessageWrite(() => repository.persistMessages(target, protectedMessages))
  .catch((error: unknown) => {
    const conversationId = protectedMessages[0]?.conversationId ?? ""
    reportCacheFailure(target, conversationId, "realtime-write", error, protectedMessages.length)
  })
  upsertRuntimeMessages(target, protectedMessages)
  for (const conversationId of new Set(
    protectedMessages.map((message) => message.conversationId)
  )) {
    events.publishConversationMessagesChanged(target, conversationId, {
      messages: protectedMessages.filter(
        (message) => message.conversationId === conversationId
      ),
      type: "upsert",
    })
  }
}

async function sendText(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendTextInput
) {
  const message = await api.sendText(
    target,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

function markRead(
  target: AuthenticatedTarget,
  conversationId: string,
  upToSeq: number
) {
  return api.markRead(target, conversationId, upToSeq)
}

async function sendFile(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & { file: ClientMessageUpload }
) {
  const message = await api.sendFile(
    target,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function sendImage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & { image: ClientMessageUpload }
) {
  const message = await api.sendImage(
    target,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function sendVideo(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & { video: ClientMessageUpload }
) {
  const message = await api.sendVideo(target, conversationId, input)
  await writeMessages(target, [message])
  return message
}

async function sendVoice(
  target: AuthenticatedTarget,
  conversationId: string,
  input: SendUploadInput & {
    durationMS: number
    transcript?: string
    voice: ClientMessageUpload
  }
) {
  const message = await api.sendVoice(
    target,
    conversationId,
    input
  )
  await writeMessages(target, [message])
  return message
}

async function revokeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string
) {
  const result = await api.revokeMessage(
    target,
    conversationId,
    messageId
  )
  await writeMessages(target, [result.message, result.systemMessage])
  return result
}

async function forwardMessage(
  target: AuthenticatedTarget,
  sourceConversationId: string,
  input: {
    clientForwardId: string
    messageId: string
    targetConversationIds: string[]
  }
) {
  const result = await api.forwardMessages(
    target,
    sourceConversationId,
    {
      clientForwardId: input.clientForwardId,
      messageIds: [input.messageId],
      targetConversationIds: input.targetConversationIds,
    }
  )
  await writeMessages(
    target,
    result.results.flatMap((item) =>
      item.status === "sent" ? item.messages : []
    )
  )
  return result
}

async function setReaction(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  input: { reacted: boolean; text: string }
) {
  const snapshot = await api.setReaction(
    target,
    conversationId,
    messageId,
    input
  )
  await applyReactionSnapshot(target, snapshot)
  return snapshot
}

async function submitChoice(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  optionIds: string[]
) {
  const result = await api.submitChoice(
    target,
    conversationId,
    messageId,
    optionIds
  )
  await applyChoiceSnapshot(target, {
    choice: result.choice,
    conversationId: result.conversationId,
    messageId: result.messageId,
    status: "active",
  })
  return result
}

function fetchChoiceSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[]
) {
  return api.fetchChoiceSnapshots(
    target,
    conversationId,
    messageIds
  )
}

async function applyChoiceSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageChoiceSnapshot
) {
  recordChoiceMessageTombstone(target, snapshot)
  await persistMessageChoiceSnapshot(target, snapshot)
  .catch(() => undefined)
  if (snapshot.status === "deleted") {
    removeRuntimeMessage(
      target,
      snapshot.conversationId,
      snapshot.messageId
    )
    events.publishConversationMessagesChanged(target, snapshot.conversationId, {
      snapshot,
      type: "choice-snapshot",
    })
    return
  }

  updateRuntimeMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (current) => applyMessageChoiceSnapshot(current, snapshot) ?? current
  )
  // Runtime is updated for future page construction. Query subscribers apply
  // the snapshot itself so messages outside the 3,000-item runtime window are
  // updated too.
  events.publishConversationMessagesChanged(target, snapshot.conversationId, {
    snapshot,
    type: "choice-snapshot",
  })
}

async function applyChoiceEvent(
  target: AuthenticatedTarget,
  event: MessageChoiceUpdatedEvent
) {
  await persistMessageChoiceEvent(target, event)
  .catch(() => undefined)
  updateRuntimeMessage(
    target,
    event.conversationId,
    event.messageId,
    (current) => applyMessageChoiceEvent(current, event, target.userId)
  )
  events.publishConversationMessagesChanged(target, event.conversationId, {
    event,
    type: "choice-event",
  })
}

async function fetchReactionSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[]
) {
  return api.fetchReactionSnapshots(
    target,
    conversationId,
    messageIds
  )
}

async function applyReactionSnapshot(
  target: AuthenticatedTarget,
  snapshot: MessageReactionSnapshot
) {
  await persistMessageReactionSnapshot(target, snapshot)
  .catch(() => undefined)
  const message = updateRuntimeMessage(
    target,
    snapshot.conversationId,
    snapshot.messageId,
    (message) => applyMessageReactionSnapshot(message, snapshot)
  )
  if (message) {
    events.publishConversationMessagesChanged(target, snapshot.conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
}

async function applyReactionEvent(
  target: AuthenticatedTarget,
  event: MessageReactionsUpdatedEvent
) {
  const persistedStatus = await persistMessageReactionsEvent(target, event)
  .catch(() => "missing" as const)
  const runtimeResult: {
    status: "applied" | "gap" | "missing" | "stale"
  } = { status: "missing" }
  const message = updateRuntimeMessage(
    target,
    event.conversationId,
    event.messageId,
    (message) => {
      const result = applyMessageReactionsUpdate(message, event, target.userId)
      runtimeResult.status = result.status
      return result.message
    }
  )
  if (message) {
    events.publishConversationMessagesChanged(target, event.conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
  return persistedStatus === "gap" || runtimeResult.status === "gap"
    ? "gap"
    : runtimeResult.status === "missing"
      ? persistedStatus
      : runtimeResult.status
}

async function updateMessageTopic(
  target: AuthenticatedTarget,
  input: {
    archived: boolean
    conversationId: string
    parentConversationId: string
    sourceMessageId: string
  }
) {
  await updateMessage(
    target,
    input.parentConversationId,
    input.sourceMessageId,
    (message) => ({
      ...message,
      topic: {
        archived: input.archived,
        conversationId: input.conversationId,
        recentReplies: message.topic?.recentReplies ?? [],
      },
    })
  )
}

async function updateTopicSourcePreview(
  target: AuthenticatedTarget,
  input: {
    message: ClientMessage
    parentConversationId: string
    sourceMessageId: string
  }
) {
  const { message } = input
  const senderType = message.sender.type
  if (senderType === "system") return
  const sender = { id: message.sender.id, type: senderType }

  await updateMessage(
    target,
    input.parentConversationId,
    input.sourceMessageId,
    (sourceMessage) => {
      if (!sourceMessage.topic) return sourceMessage

      const existingReplies = sourceMessage.topic.recentReplies.filter(
        (reply) => reply.id !== message.id
      )
      const recentReplies =
        message.body.type === "revoked"
          ? existingReplies
          : [
              ...existingReplies,
              {
                createdAt: message.createdAt,
                id: message.id,
                sender,
                summary: formatClientMessageBodySummary(
                  message.body,
                  () => undefined
                ),
              },
            ].slice(-3)

      return {
        ...sourceMessage,
        topic: { ...sourceMessage.topic, recentReplies },
      }
    }
  )
}

async function updateMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  await updatePersistedMessage(target, conversationId, messageId, update)
  .catch(() => undefined)
  const message = updateRuntimeMessage(
    target,
    conversationId,
    messageId,
    update
  )
  if (message) {
    events.publishConversationMessagesChanged(target, conversationId, {
      messages: [message],
      type: "upsert",
    })
  }
}

async function clearConversation(
  target: AuthenticatedTarget,
  conversationId: string
) {
  await removeConversationMessageCache(target, conversationId)
  .catch(() => undefined)
  runtimeMessages.delete(createRuntimeConversationKey(target, conversationId))
  runtimePageState.delete(createRuntimeConversationKey(target, conversationId))
  clearConversationMessageTombstones(target, conversationId)
  events.publishConversationMessagesChanged(target, conversationId, { type: "clear" })
}

async function clearServer(server: ServerTarget) {
  await removeServerMessageCache(server).catch(
    () => undefined
  )
  const keys = new Set([
    ...runtimeMessages.keys(),
    ...runtimePageState.keys(),
  ])
  for (const key of keys) {
    if (!runtimeKeyBelongsToServer(key, server)) continue

    runtimeMessages.delete(key)
    runtimePageState.delete(key)
  }
  clearServerMessageTombstones(server)
}

function upsertRuntimeMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  for (const candidate of messages) {
    const incoming = applyChoiceMessageTombstone(target, candidate)
    const key = createRuntimeConversationKey(target, candidate.conversationId)
    if (!incoming) {
      runtimeMessages.get(key)?.delete(candidate.id)
      continue
    }
    const conversation = runtimeMessages.get(key) ?? new Map()
    const current = conversation.get(incoming.id)
    conversation.set(
      incoming.id,
      current
        ? preserveNewerMessageState(current, incoming)
        : incoming
    )
    if (conversation.size > MAX_RUNTIME_MESSAGES_PER_CONVERSATION) {
      const retainedIds = new Set(
        Array.from(conversation.values())
          .sort((left, right) => right.seq - left.seq)
          .slice(0, MAX_RUNTIME_MESSAGES_PER_CONVERSATION)
          .map((message) => message.id)
      )
      for (const messageId of conversation.keys()) {
        if (!retainedIds.has(messageId)) conversation.delete(messageId)
      }
    }
    runtimeMessages.set(key, conversation)
  }
}

function applyMessageTombstones(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
) {
  return messages.flatMap((message) => {
    const protectedMessage = applyChoiceMessageTombstone(target, message)
    return protectedMessage ? [protectedMessage] : []
  })
}

function applyMessageListTombstones(
  target: AuthenticatedTarget,
  list: ClientMessageList
) {
  const messages = applyMessageTombstones(target, list.messages)
  return {
    ...list,
    messages,
    page: updatePageRange(list.page, messages),
  }
}

function updateRuntimeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  const conversation = runtimeMessages.get(
    createRuntimeConversationKey(target, conversationId)
  )
  const message = conversation?.get(messageId)
  if (!message) return null

  const next = update(message)
  conversation!.set(messageId, next)
  return next
}

function removeRuntimeMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string
) {
  return runtimeMessages
    .get(createRuntimeConversationKey(target, conversationId))
    ?.delete(messageId)
}

function readRuntimeMessages(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return Array.from(
    runtimeMessages.get(
      createRuntimeConversationKey(target, conversationId)
    )?.values() ?? []
  )
}

function createRuntimeConversationKey(
  target: AuthenticatedTarget,
  conversationId: string
) {
  return JSON.stringify([
    target.id,
    target,
    target.userId,
    conversationId,
  ])
}

function runtimeKeyBelongsToServer(key: string, server: ServerTarget) {
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

function mergeMessages(messages: ClientMessage[]) {
  const byId = new Map<string, ClientMessage>()
  for (const message of messages) {
    const current = byId.get(message.id)
    byId.set(
      message.id,
      current
        ? preserveNewerMessageState(current, message)
        : message
    )
  }
  return Array.from(byId.values()).sort((left, right) => right.seq - left.seq)
}

function createCachedPage(
  messages: ClientMessage[],
  limit: number,
  hasMoreBefore: boolean,
  fallbackSeq: number
): ClientMessageList {
  return {
    messages,
    page: {
      hasMoreAfter: false,
      hasMoreBefore,
      limit,
      newestSeq: messages[0]?.seq ?? fallbackSeq,
      oldestSeq: messages[messages.length - 1]?.seq ?? fallbackSeq,
    },
  }
}

function reportCacheFailure(
  target: AuthenticatedTarget,
  conversationId: string,
  operation: string,
  error: unknown,
  messageCount = 0
) {
  telemetry.reportMessageCacheError({
    target,
    conversationId,
    messageCount,
    operation,
    error,
  })
}

function createRuntimePage(
  messages: ClientMessage[],
  limit: number,
  page?: ClientMessagePage
): ClientMessageList {
  return {
    messages,
    page: {
      hasMoreAfter: page?.hasMoreAfter ?? false,
      hasMoreBefore: page?.hasMoreBefore ?? false,
      limit,
      newestSeq: messages[0]?.seq ?? page?.newestSeq ?? 0,
      oldestSeq:
        messages[messages.length - 1]?.seq ?? page?.oldestSeq ?? 0,
    },
  }
}

function updatePageRange(
  page: ClientMessageList["page"],
  messages: ClientMessage[]
) {
  return {
    ...page,
    newestSeq: messages[0]?.seq ?? page.newestSeq,
    oldestSeq: messages[messages.length - 1]?.seq ?? page.oldestSeq,
  }
}

function createLatestRuntimePage(
  target: AuthenticatedTarget,
  conversationId: string,
  result: ClientMessageList,
  limit: number
) {
  const messages = mergeMessages([
    ...result.messages,
    ...readRuntimeMessages(target, conversationId),
  ]).slice(0, limit)
  return {
    ...result,
    messages,
    page: updatePageRange(result.page, messages),
  }
}

  return manager
}
