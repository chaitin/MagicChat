import {
  type InfiniteData,
  replaceEqualDeep,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo } from "react"

import {
  fetchConversationMessages,
  forwardConversationMessages,
  markConversationRead,
  revokeConversationMessage,
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationTextMessage,
  sendConversationVoiceMessage,
  setConversationMessageReaction,
} from "@/data/messages-api"
import { updateCachedMessageReactionSnapshot } from "@/data/message-reaction-cache"
import type {
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "@/data/models"
import type { ClientMessageUpload } from "@/data/message-upload"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"
import { updateCachedTopicSourcePreview } from "@/data/topic-cache"
import { preserveNewerMessageReactionState } from "@/domain/messages/message-reactions"

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
    structuralSharing: (current, incoming) =>
      preserveNewerMessageReactions(
        current as
          | InfiniteData<ClientMessageList, number | null>
          | undefined,
        incoming as InfiniteData<ClientMessageList, number | null>
      ),
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
    messages,
    refetch: query.refetch,
  }
}

export function useSendConversationTextMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useSendConversationMessageMutation(
    server,
    conversationId,
    (input: {
      clientMessageId: string
      content: string
      replyToMessageId?: string
    }) =>
      sendConversationTextMessage(server.url, conversationId, input)
  )
}

export function useSetConversationMessageReaction(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      messageId: string
      reacted: boolean
      text: string
    }) =>
      setConversationMessageReaction(
        server.url,
        conversationId,
        input.messageId,
        { reacted: input.reacted, text: input.text }
      ),
    onSuccess: (snapshot) => {
      updateCachedMessageReactionSnapshot(queryClient, server, snapshot)
    },
  })
}

export function useSendConversationFileMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useSendConversationMessageMutation(
    server,
    conversationId,
    (input: {
      clientMessageId: string
      file: ClientMessageUpload
      replyToMessageId?: string
    }) =>
      sendConversationFileMessage(server.url, conversationId, input)
  )
}

export function useSendConversationImageMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useSendConversationMessageMutation(
    server,
    conversationId,
    (input: {
      clientMessageId: string
      image: ClientMessageUpload
      replyToMessageId?: string
    }) =>
      sendConversationImageMessage(server.url, conversationId, input)
  )
}

export function useSendConversationVoiceMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useSendConversationMessageMutation(
    server,
    conversationId,
    (input: {
      clientMessageId: string
      durationMS: number
      replyToMessageId?: string
      voice: ClientMessageUpload
    }) => sendConversationVoiceMessage(server.url, conversationId, input)
  )
}

export function useRevokeConversationMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) =>
      revokeConversationMessage(server.url, conversationId, messageId),
    onSuccess: ({ message, systemMessage }) => {
      queryClient.setQueryData<InfiniteData<ClientMessageList, number | null>>(
        queryKeys.conversationMessages(server, conversationId),
        (current) => upsertMessages(current, [message, systemMessage])
      )
      updateCachedTopicSourcePreview(queryClient, server, message)
      updateCachedTopicSourcePreview(queryClient, server, systemMessage)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations(server),
      })
    },
  })
}

export function useForwardConversationMessage(
  server: AuthenticatedTarget,
  sourceConversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      clientForwardId: string
      messageId: string
      targetConversationIds: string[]
    }) =>
      forwardConversationMessages(
        server.url,
        sourceConversationId,
        {
          clientForwardId: input.clientForwardId,
          messageIds: [input.messageId],
          targetConversationIds: input.targetConversationIds,
        }
      ),
    onSuccess: (result) => {
      for (const target of result.results) {
        if (target.status !== "sent") continue

        queryClient.setQueryData<
          InfiniteData<ClientMessageList, number | null>
        >(
          queryKeys.conversationMessages(server, target.conversationId),
          (current) => upsertMessages(current, target.messages)
        )
        for (const message of target.messages) {
          updateCachedTopicSourcePreview(queryClient, server, message)
        }
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversations(server),
      })
    },
  })
}

function useSendConversationMessageMutation<TInput>(
  server: AuthenticatedTarget,
  conversationId: string,
  sendMessage: (input: TInput) => Promise<ClientMessage>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: sendMessage,
    onSuccess: (message) => {
      queryClient.setQueryData<InfiniteData<ClientMessageList, number | null>>(
        queryKeys.conversationMessages(server, conversationId),
        (current) => upsertMessages(current, [message])
      )
      updateCachedTopicSourcePreview(queryClient, server, message)
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

function mergeMessages(messages: ClientMessage[]) {
  const messagesById = new Map<string, ClientMessage>()

  for (const message of messages) {
    const current = messagesById.get(message.id)
    messagesById.set(
      message.id,
      current
        ? preserveNewerMessageReactionState(current, message)
        : message
    )
  }

  return Array.from(messagesById.values()).sort(
    (left, right) => right.seq - left.seq
  )
}

function preserveNewerMessageReactions(
  current: InfiniteData<ClientMessageList, number | null> | undefined,
  incoming: InfiniteData<ClientMessageList, number | null>
) {
  if (!current) return incoming

  const currentMessages = new Map(
    current.pages.flatMap((page) =>
      page.messages.map((message) => [message.id, message] as const)
    )
  )
  const merged = {
    ...incoming,
    pages: incoming.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) => {
        const previous = currentMessages.get(message.id)
        return previous
          ? preserveNewerMessageReactionState(previous, message)
          : message
      }),
    })),
  }
  return replaceEqualDeep(current, merged)
}

function upsertMessages(
  current: InfiniteData<ClientMessageList, number | null> | undefined,
  messages: ClientMessage[]
) {
  if (!current || current.pages.length === 0 || messages.length === 0) {
    return current
  }

  const updates = new Map(messages.map((message) => [message.id, message]))
  const found = new Set<string>()
  const pages = current.pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      const update = updates.get(message.id)
      if (!update) return message

      found.add(message.id)
      return update
    }),
  }))
  const missing = messages.filter((message) => !found.has(message.id))
  const newestSeq = messages.reduce(
    (currentNewest, message) => Math.max(currentNewest, message.seq),
    pages[0]?.page.newestSeq ?? 0
  )

  return {
    ...current,
    pages: pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            messages: mergeMessages([...page.messages, ...missing]),
            page: { ...page.page, newestSeq },
          }
        : page
    ),
  }
}
