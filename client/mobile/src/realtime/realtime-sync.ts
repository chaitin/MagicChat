import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { contactManager } from "@/data/contacts"
import { messageManager } from "@/data/messages"
import { AUTO_MESSAGE_PAGE_SIZE, catchUpMessagesTo, createMessageSyncBudget } from "@/features/bootstrap/message-sync-budget"
import { projectManager } from "@/data/projects"
import { queryKeys } from "@/data/query"
import { synchronizeConversationMessageChoices } from "./choice-sync"
import { synchronizeConversationMessageReactions } from "./reaction-sync"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>

export async function synchronizeRealtimeData(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: { activeConversationId?: string } = {}
) {
  const { snapshot: conversations } = await conversationManager.refreshSnapshot(server)
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  )
  const syncStates = await messageManager.listSyncStates(server).catch(
    () => []
  )
  const syncStateConversationIds = new Set(
    syncStates.map((state) => state.conversationId)
  )
  const budget = createMessageSyncBudget()
  const prioritizedStates = [...syncStates].sort((left, right) =>
    compareCatchUpPriority(
      left.conversationId,
      right.conversationId,
      conversationById,
      options.activeConversationId
    )
  )

  for (const state of prioritizedStates) {
    const conversation = conversationById.get(state.conversationId)
    if (!conversation) continue
    const decision = budget.decide(conversation, state)
    if (decision.type === "latest") {
      await messageManager.synchronizeLatest(server, state.conversationId, AUTO_MESSAGE_PAGE_SIZE)
    } else if (decision.type === "after") {
      await catchUpMessagesTo(server, state.conversationId, decision.afterSeq, decision.targetSeq, messageManager.catchUpAfter)
    }
  }

  const loadedConversationQueries =
    queryClient.getQueriesData<MessageInfiniteData>({
      queryKey: [...queryKeys.authenticated(server), "conversation"],
    })

  for (const [queryKey, data] of loadedConversationQueries) {
    const conversationId = getConversationIdFromMessageQueryKey(queryKey)
    if (
      !conversationId ||
      !data ||
      syncStateConversationIds.has(conversationId)
    ) {
      continue
    }

    const newestSeq = getNewestMessageSeq(data)
    const conversation = conversationById.get(conversationId)
    if (conversation && newestSeq > 0) {
      const decision = budget.decide(conversation, { httpSyncedThroughSeq: newestSeq })
      if (decision.type === "after") {
        await catchUpMessagesTo(server, conversationId, decision.afterSeq, decision.targetSeq, messageManager.catchUpAfter)
      }
    }
  }

  await Promise.all(
    loadedConversationQueries.flatMap(([queryKey, data]) => {
      const conversationId = getConversationIdFromMessageQueryKey(queryKey)
      const messageIds = data ? getLoadedMessageIds(data) : []
      if (!conversationId || messageIds.length === 0) return []

      const operations: Promise<void>[] = [
        synchronizeConversationMessageReactions(
          queryClient,
          server,
          conversationId,
          messageIds
        ),
      ]
      const choiceMessageIds = data ? getLoadedChoiceMessageIds(data) : []
      if (choiceMessageIds.length > 0) {
        operations.push(
          synchronizeConversationMessageChoices(
            queryClient,
            server,
            conversationId,
            choiceMessageIds
          )
        )
      }
      return operations
    })
  )
}

export async function refreshClientDataOnForeground(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: { activeConversationId?: string } = {}
) {
  await Promise.all([
    contactManager.refresh(server),
    queryClient.invalidateQueries(
      {
        exact: true,
        queryKey: queryKeys.currentUser(server),
      },
      { cancelRefetch: false }
    ),
    projectManager.refresh(server),
    synchronizeRealtimeData(queryClient, server, options),
  ])
}


function compareCatchUpPriority(
  leftId: string,
  rightId: string,
  conversations: ReadonlyMap<string, ClientConversation>,
  activeConversationId: string | undefined
) {
  const left = conversations.get(leftId)
  const right = conversations.get(rightId)
  const leftPriority = catchUpPriority(leftId, left, activeConversationId)
  const rightPriority = catchUpPriority(rightId, right, activeConversationId)
  return rightPriority - leftPriority
}

function catchUpPriority(
  conversationId: string,
  conversation: ClientConversation | undefined,
  activeConversationId: string | undefined
) {
  const active = conversationId === activeConversationId ? 1e16 : 0
  const unread = (conversation?.unreadCount ?? 0) > 0 ? 1e15 : 0
  const recent = conversation?.lastMessageAt
    ? Date.parse(conversation.lastMessageAt)
    : 0
  return active + unread + (Number.isFinite(recent) ? recent : 0)
}


function getLoadedMessageIds(data: MessageInfiniteData) {
  return data.pages.flatMap((page) =>
    page.messages.map((message) => message.id)
  )
}

function getLoadedChoiceMessageIds(data: MessageInfiniteData) {
  return data.pages.flatMap((page) =>
    page.messages.flatMap((message) =>
      message.body.type === "choice" ? [message.id] : []
    )
  )
}

function getNewestMessageSeq(data: MessageInfiniteData) {
  return data.pages.reduce(
    (newest, page) =>
      page.messages.reduce(
        (pageNewest, message) => Math.max(pageNewest, message.seq),
        newest
      ),
    0
  )
}

function getConversationIdFromMessageQueryKey(queryKey: readonly unknown[]) {
  return queryKey.length === 8 &&
    queryKey[0] === "server" &&
    queryKey[3] === "user" &&
    queryKey[5] === "conversation" &&
    typeof queryKey[6] === "string" &&
    queryKey[7] === "messages"
    ? queryKey[6]
    : null
}
