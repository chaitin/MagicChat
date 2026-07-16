import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo } from "react"

import {
  fetchConversationMessages,
  fetchTemporaryFileReadUrls,
  markConversationRead,
  sendConversationTextMessage,
} from "@/data/messages-api"
import type {
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "@/data/models"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"

const MESSAGE_PAGE_SIZE = 20
const MESSAGE_REFRESH_INTERVAL_MS = 5_000

export function useConversationMessages(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const query = useInfiniteQuery<
    ClientMessageList,
    Error,
    InfiniteData<ClientMessageList, number | null>,
    ReturnType<typeof queryKeys.conversationMessages>,
    number | null
  >({
    enabled: conversationId.length > 0,
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMoreBefore ? lastPage.page.oldestSeq : undefined,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      fetchConversationMessages(
        server.url,
        conversationId,
        {
          beforeSeq: pageParam ?? undefined,
          limit: MESSAGE_PAGE_SIZE,
        },
        { signal }
      ),
    queryKey: queryKeys.conversationMessages(server, conversationId),
    refetchInterval: MESSAGE_REFRESH_INTERVAL_MS,
  })
  const messages = useMemo(
    () => mergeMessages(query.data?.pages.flatMap((page) => page.messages) ?? []),
    [query.data?.pages]
  )

  return {
    error: query.error,
    fetchOlder: query.fetchNextPage,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
    messages,
    refetch: query.refetch,
  }
}

export function useSendConversationTextMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { clientMessageId: string; content: string }) =>
      sendConversationTextMessage(server.url, conversationId, input),
    onSuccess: (message) => {
      queryClient.setQueryData<InfiniteData<ClientMessageList, number | null>>(
        queryKeys.conversationMessages(server, conversationId),
        (current) => appendMessage(current, message)
      )
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations(server),
      })
    },
  })
}

export function useMarkConversationRead(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (upToSeq: number) =>
      markConversationRead(server.url, conversationId, upToSeq),
    onMutate: (upToSeq) => {
      void queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(server),
      })
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(server),
        (current) =>
          current?.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  lastReadSeq: Math.max(conversation.lastReadSeq, upToSeq),
                  unreadCount: 0,
                }
              : conversation
          )
      )
    },
    onError: () => {
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(server),
      })
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(server),
        (current) =>
          current?.map((conversation) =>
            conversation.id === result.conversationId
              ? mergeConversationReadResult(conversation, result)
              : conversation
          )
      )
    },
  })
}

function mergeConversationReadResult(
  conversation: ClientConversation,
  result: {
    lastReadSeq: number
    unreadCount: number
  }
) {
  const lastReadSeq = Math.max(conversation.lastReadSeq, result.lastReadSeq)

  return {
    ...conversation,
    lastReadSeq,
    unreadCount:
      lastReadSeq >= conversation.lastMessageSeq
        ? 0
        : Math.min(conversation.unreadCount, result.unreadCount),
  }
}

export function useTemporaryFileUrls(
  server: AuthenticatedTarget,
  fileIds: string[]
) {
  const uniqueFileIds = useMemo(
    () => Array.from(new Set(fileIds)).sort(),
    [fileIds]
  )

  return useQuery({
    enabled: uniqueFileIds.length > 0,
    queryFn: ({ signal }) =>
      fetchTemporaryFileReadUrls(server.url, uniqueFileIds, { signal }),
    queryKey: queryKeys.temporaryFileUrls(server, uniqueFileIds),
    staleTime: 5 * 60 * 1_000,
  })
}

function mergeMessages(messages: ClientMessage[]) {
  const messagesById = new Map<string, ClientMessage>()

  for (const message of messages) {
    messagesById.set(message.id, message)
  }

  return Array.from(messagesById.values()).sort(
    (left, right) => right.seq - left.seq
  )
}

function appendMessage(
  current: InfiniteData<ClientMessageList, number | null> | undefined,
  message: ClientMessage
) {
  if (!current || current.pages.length === 0) {
    return current
  }

  return {
    ...current,
    pages: current.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            messages: mergeMessages([...page.messages, message]),
            page: {
              ...page.page,
              newestSeq: Math.max(page.page.newestSeq, message.seq),
            },
          }
        : page
    ),
  }
}
