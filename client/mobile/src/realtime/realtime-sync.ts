import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import type { ClientConversation, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { contactManager } from "@/data/contacts"
import { messageManager } from "@/data/messages"
import { projectManager } from "@/data/projects"
import { queryKeys } from "@/data/query"
import { synchronizeConversationMessageChoices } from "./choice-sync"
import { synchronizeConversationMessageReactions } from "./reaction-sync"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>
const CATCH_UP_PAGE_SIZE = 20

export async function synchronizeRealtimeData(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  options: { activeConversationId?: string } = {}
) {
  const conversations = await conversationManager.refresh(server)
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation])
  )
  const syncStates = await messageManager.listSyncStates(server).catch(
    () => []
  )
  const syncStateConversationIds = new Set(
    syncStates.map((state) => state.conversationId)
  )
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
    const isActive = state.conversationId === options.activeConversationId
    if (!conversation && !isActive) continue

    if (state.httpSyncedThroughSeq === 0) {
      await messageManager.synchronizeLatest(
        server,
        state.conversationId,
        CATCH_UP_PAGE_SIZE
      )
      continue
    }

    if (
      isActive ||
      (conversation?.lastMessageSeq ?? 0) > state.httpSyncedThroughSeq
    ) {
      await catchUpConversationMessages(
        server,
        state.conversationId,
        state.httpSyncedThroughSeq
      )
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
    if (newestSeq > 0) {
      await catchUpConversationMessages(
        server,
        conversationId,
        newestSeq
      )
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

async function catchUpConversationMessages(
  server: AuthenticatedTarget,
  conversationId: string,
  initialAfterSeq: number
) {
  let afterSeq = initialAfterSeq

  for (let pageIndex = 0; ; pageIndex += 1) {
    const { committedSeq, result } = await messageManager.catchUpAfter(
      server,
      conversationId,
      afterSeq,
      CATCH_UP_PAGE_SIZE
    )

    if (!result.page.hasMoreAfter) {
      return
    }

    if (committedSeq <= afterSeq) {
      throw new Error("消息增量同步游标没有向前推进")
    }
    afterSeq = committedSeq

    if (pageIndex > 0 && pageIndex % 10 === 0) {
      await yieldToEventLoop()
    }
  }
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

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
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
