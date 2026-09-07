import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import type {
  ClientMessage,
  ClientMessageList,
  MessageChoiceSnapshot,
  MessageChoiceUpdatedEvent,
} from "@/core/models"
import type { ConversationMessagesChangedEvent } from "@/data/messages/message-events"
import { messageManager } from "@/data/messages/message-manager"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"
import {
  applyMessageChoiceEvent,
  applyMessageChoiceSnapshot,
} from "@/domain/messages/message-choices"
import { preserveNewerMessageState } from "@/domain/messages/message-reactions"

type ConversationMessagesData = InfiniteData<
  ClientMessageList,
  number | null
>

export function cacheBootstrappedConversationMessages(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  pages: ReadonlyMap<string, ClientMessageList>
) {
  for (const [conversationId, page] of pages) {
    queryClient.setQueryData<ConversationMessagesData>(
      queryKeys.conversationMessages(target, conversationId),
      (current) =>
        current
          ? replaceLatestConversationPage(current, page)
          : { pageParams: [null], pages: [page] }
    )
  }
}

export async function hydrateConversationMessagesQuery(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
) {
  const queryKey = queryKeys.conversationMessages(target, conversationId)

  // Query presence only means a snapshot was cached. Runtime/SQLite may have
  // advanced since then (including bootstrap work that finished after timeout).
  // The messages tab can hydrate while a conversation screen remains mounted
  // above it, so hydration must preserve every history page already in use.
  const page = await messageManager.readLatestPage(
    target,
    conversationId,
    limit
  )
  if (page.messages.length === 0) return false

  queryClient.setQueryData<ConversationMessagesData>(
    queryKey,
    (latest) =>
      latest
        ? replaceLatestConversationPage(latest, page)
        : { pageParams: [null], pages: [page] }
  )
  return true
}

export function compactConversationMessagesQuery(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string
) {
  queryClient.setQueryData<ConversationMessagesData>(
    queryKeys.conversationMessages(target, conversationId),
    compactConversationMessagesData
  )
}

export function applyConversationMessagesChangedEvent(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  event: ConversationMessagesChangedEvent
) {
  const queryKey = queryKeys.conversationMessages(target, conversationId)
  if (event.type === "clear") {
    queryClient.removeQueries({ exact: true, queryKey })
    return
  }

  queryClient.setQueryData<ConversationMessagesData>(queryKey, (current) => {
    if (event.type === "latest-page") {
      return current
        ? replaceLatestConversationPage(current, event.page)
        : { pageParams: [null], pages: [event.page] }
    }
    if (event.type === "remove") {
      return removeConversationMessages(current, event.messageIds)
    }
    if (event.type === "choice-snapshot") {
      return applyChoiceSnapshotToConversationMessages(
        current,
        event.snapshot
      )
    }
    if (event.type === "choice-event") {
      return applyChoiceEventToConversationMessages(
        current,
        event.event,
        target.userId
      )
    }
    if (!current || event.messages.length === 0) return current
    return upsertConversationMessages(current, event.messages)
  })
}

function applyChoiceSnapshotToConversationMessages(
  current: ConversationMessagesData | undefined,
  snapshot: MessageChoiceSnapshot
) {
  if (snapshot.status === "deleted") {
    return removeConversationMessages(current, [snapshot.messageId])
  }
  return updateConversationMessage(current, snapshot.messageId, (message) =>
    applyMessageChoiceSnapshot(message, snapshot) ?? message
  )
}

function applyChoiceEventToConversationMessages(
  current: ConversationMessagesData | undefined,
  event: MessageChoiceUpdatedEvent,
  currentUserId: string
) {
  return updateConversationMessage(current, event.messageId, (message) =>
    applyMessageChoiceEvent(message, event, currentUserId)
  )
}

function updateConversationMessage(
  current: ConversationMessagesData | undefined,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  if (!current) return current
  let changed = false
  const pages = current.pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      if (message.id !== messageId) return message
      const next = update(message)
      if (next !== message) changed = true
      return next
    }),
  }))
  return changed ? { ...current, pages } : current
}

function removeConversationMessages(
  current: ConversationMessagesData | undefined,
  messageIds: string[]
) {
  if (!current || messageIds.length === 0) return current
  const removed = new Set(messageIds)
  let changed = false
  const pages = current.pages.map((page) => {
    const messages = page.messages.filter((message) => !removed.has(message.id))
    if (messages.length === page.messages.length) return page
    changed = true
    return {
      ...page,
      messages,
      page: {
        ...page.page,
        newestSeq: messages[0]?.seq ?? page.page.newestSeq,
        oldestSeq: messages[messages.length - 1]?.seq ?? page.page.oldestSeq,
      },
    }
  })
  return changed ? { ...current, pages } : current
}

function compactConversationMessagesData(
  current: ConversationMessagesData | undefined
) {
  const latestPage = current?.pages[0]
  if (!current || !latestPage) return current
  return {
    pageParams: [null],
    pages: [latestPage],
  }
}

function upsertConversationMessages(
  current: ConversationMessagesData,
  messages: ClientMessage[]
) {
  const updates = new Map(messages.map((message) => [message.id, message]))
  const found = new Set<string>()
  const pages = current.pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      const update = updates.get(message.id)
      if (!update) return message

      found.add(message.id)
      return preserveNewerMessageState(message, update)
    }),
  }))
  const latestPage = pages[0]
  if (!latestPage) return current

  const missingLatestMessages = messages.filter(
    (message) =>
      !found.has(message.id) &&
      (latestPage.messages.length === 0 ||
        message.seq >= latestPage.page.oldestSeq)
  )
  if (missingLatestMessages.length === 0) {
    return { ...current, pages }
  }

  return repageConversationMessages(
    current,
    mergeMessages([
      ...pages.flatMap((page) => page.messages),
      ...missingLatestMessages,
    ]),
    latestPage.page
  )
}

function replaceLatestConversationPage(
  current: ConversationMessagesData,
  latestPage: ClientMessageList
) {
  const currentLatestPage = current.pages[0]
  if (
    currentLatestPage &&
    currentLatestPage.messages.length === latestPage.messages.length &&
    currentLatestPage.messages.every(
      (message, index) => message.id === latestPage.messages[index]?.id
    )
  ) {
    const messages = latestPage.messages.map((message, index) => {
      const currentMessage = currentLatestPage.messages[index]
      return currentMessage
        ? preserveNewerMessageState(currentMessage, message)
        : message
    })
    return {
      ...current,
      pages: [
        { ...latestPage, messages },
        ...current.pages.slice(1),
      ],
    }
  }

  return repageConversationMessages(
    current,
    mergeMessages([
      ...latestPage.messages,
      ...current.pages.flatMap((page) => page.messages),
    ]),
    latestPage.page
  )
}

function repageConversationMessages(
  current: ConversationMessagesData,
  messages: ClientMessage[],
  latestPage: ClientMessageList["page"]
) {
  const pageSize = latestPage.limit
  const chunks: ClientMessage[][] = []
  for (let index = 0; index < messages.length; index += pageSize) {
    chunks.push(messages.slice(index, index + pageSize))
  }
  if (chunks.length === 0) chunks.push([])

  const previousOldestPage = current.pages[current.pages.length - 1]?.page
  const pages = chunks.map((chunk, index) => ({
    messages: chunk,
    page: {
      hasMoreAfter: index > 0,
      hasMoreBefore:
        index < chunks.length - 1
          ? true
          : current.pages.length > 1
            ? (previousOldestPage?.hasMoreBefore ?? true)
            : latestPage.hasMoreBefore,
      limit: pageSize,
      newestSeq: chunk[0]?.seq ?? latestPage.newestSeq,
      oldestSeq: chunk[chunk.length - 1]?.seq ?? latestPage.oldestSeq,
    },
  }))
  const pageParams: (number | null)[] = [null]
  for (let index = 1; index < pages.length; index += 1) {
    pageParams.push(pages[index - 1]?.page.oldestSeq ?? null)
  }

  return {
    pageParams,
    pages,
  }
}

function mergeMessages(messages: ClientMessage[]) {
  const messagesById = new Map<string, ClientMessage>()
  for (const message of messages) {
    const current = messagesById.get(message.id)
    messagesById.set(
      message.id,
      current
        ? preserveNewerMessageState(current, message)
        : message
    )
  }
  return Array.from(messagesById.values()).sort(
    (left, right) => right.seq - left.seq
  )
}
