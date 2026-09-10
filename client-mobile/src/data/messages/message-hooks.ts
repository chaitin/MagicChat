import {
  type InfiniteData,
  replaceEqualDeep,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"

import { conversationManager } from "@/data/conversations/index"
import { FALLBACK_POLLING_INTERVAL_MS } from "@/data/query/fallback-polling"
import {
  messageManager,
  subscribeConversationMessages,
} from "@/data/messages"
import {
  applyConversationMessagesChangedEvent,
  compactConversationMessagesQuery,
} from "@/data/messages/message-query-cache"
import type {
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "@/core/models"
import type { ClientMessageUpload } from "@/data/messages/message-upload"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"
import { preserveNewerMessageState } from "@/domain/messages/message-reactions"

const MESSAGE_PAGE_SIZE = 20
export function useConversationMessages(
  server: AuthenticatedTarget,
  conversationId: string,
  options: { fallbackPollingEnabled?: boolean; live?: boolean } = {}
) {
  const live = options.live ?? true
  const queryClient = useQueryClient()
  const queryKey = useMemo(
    () => queryKeys.conversationMessages(server, conversationId),
    [conversationId, server]
  )
  const [synchronizationError, setSynchronizationError] =
    useState<Error | null>(null)
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
      messageManager.loadMessagePage(
        server,
        conversationId,
        {
          beforeSeq: pageParam ?? undefined,
          limit: MESSAGE_PAGE_SIZE,
        },
        { signal }
      ),
    queryKey,
    staleTime: Infinity,
    structuralSharing: (current, incoming) =>
      preserveNewerMessageReactions(
        current as
          | InfiniteData<ClientMessageList, number | null>
          | undefined,
        incoming as InfiniteData<ClientMessageList, number | null>
      ),
  })

  useEffect(
    () => {
      if (!live) return
      return subscribeConversationMessages(server, conversationId, (event) => {
        applyConversationMessagesChangedEvent(
          queryClient,
          server,
          conversationId,
          event
        )
      })
    },
    [conversationId, live, queryClient, queryKey, server]
  )

  useEffect(
    () => () => {
      if (!live) return
      compactConversationMessagesQuery(
        queryClient,
        server,
        conversationId
      )
    },
    [conversationId, live, queryClient, server]
  )

  useEffect(() => {
    if (!conversationId || !live) return

    let active = true
    const synchronize = () => {
      void messageManager
        .synchronizeLatest(server, conversationId, MESSAGE_PAGE_SIZE)
        .then(() => {
          if (active) setSynchronizationError(null)
        })
        .catch((error: unknown) => {
          if (active) {
            setSynchronizationError(
              error instanceof Error ? error : new Error("加载消息失败")
            )
          }
        })
    }

    synchronize()
    const interval = options.fallbackPollingEnabled
      ? setInterval(synchronize, FALLBACK_POLLING_INTERVAL_MS)
      : null
    return () => {
      active = false
      if (interval !== null) clearInterval(interval)
    }
  }, [conversationId, live, options.fallbackPollingEnabled, server])

  const refetch = useCallback(async () => {
    await messageManager.synchronizeLatest(
      server,
      conversationId,
      MESSAGE_PAGE_SIZE
    )
  }, [conversationId, server])

  const messages = useMemo(
    () => mergeMessages(query.data?.pages.flatMap((page) => page.messages) ?? []),
    [query.data?.pages]
  )

  return {
    error: synchronizationError ?? query.error,
    fetchOlder: query.fetchNextPage,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    isLoading: query.isLoading,
    messages,
    refetch,
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
    }) => messageManager.sendText(server, conversationId, input)
  )
}

export function useSetConversationMessageReaction(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useMutation({
    mutationFn: (input: {
      messageId: string
      reacted: boolean
      text: string
    }) =>
      messageManager.setReaction(
        server,
        conversationId,
        input.messageId,
        { reacted: input.reacted, text: input.text }
      ),
  })
}

export function useSubmitConversationMessageChoiceResponse(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useMutation({
    mutationFn: (input: { messageId: string; optionIds: string[] }) =>
      messageManager.submitChoice(
        server,
        conversationId,
        input.messageId,
        input.optionIds
      ),
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
    }) => messageManager.sendFile(server, conversationId, input)
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
    }) => messageManager.sendImage(server, conversationId, input)
  )
}

export function useSendConversationVideoMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  return useSendConversationMessageMutation(
    server,
    conversationId,
    (input: {
      clientMessageId: string
      replyToMessageId?: string
      video: ClientMessageUpload
    }) => messageManager.sendVideo(server, conversationId, input)
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
      transcript?: string
      voice: ClientMessageUpload
    }) => messageManager.sendVoice(server, conversationId, input)
  )
}

export function useRevokeConversationMessage(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) =>
      messageManager.revokeMessage(server, conversationId, messageId),
    onSuccess: ({ message, systemMessage }) => {
      persistTopicSourcePreview(queryClient, server, message)
      persistTopicSourcePreview(queryClient, server, systemMessage)
      void updateConversationFromSentMessage(server, systemMessage)
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
      messageManager.forwardMessage(
        server,
        sourceConversationId,
        {
          clientForwardId: input.clientForwardId,
          messageId: input.messageId,
          targetConversationIds: input.targetConversationIds,
        }
      ),
    onSuccess: (result) => {
      for (const target of result.results) {
        if (target.status !== "sent") continue

        for (const message of target.messages) {
          persistTopicSourcePreview(queryClient, server, message)
          void updateConversationFromSentMessage(server, message)
        }
      }
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
      persistTopicSourcePreview(queryClient, server, message)
      void updateConversationFromSentMessage(server, message)
    },
  })
}

async function updateConversationFromSentMessage(
  target: AuthenticatedTarget,
  message: ClientMessage
) {
  const updated = await conversationManager.patch(
    target,
    message.conversationId,
    (conversation) => {
      if (message.seq < conversation.lastMessageSeq) return {}

      const member = conversation.members?.find(
        (item) =>
          item.id === message.sender.id && item.type === message.sender.type
      )
      return {
        lastMessageAt: message.createdAt,
        lastMessageId: message.id,
        lastMessageSeq: message.seq,
        lastMessageSender:
          message.sender.type === "system"
            ? {
                id: message.sender.id,
                name: "系统",
                nickname: "",
                type: "system",
              }
            : {
                id: message.sender.id,
                name: member?.name ?? "",
                nickname: member?.nickname ?? "",
                type: message.sender.type,
              },
        lastMessageSummary: formatClientMessageBodySummary(
          message.body,
          () => undefined
        ),
      }
    }
  )
  if (!updated) void conversationManager.refresh(target).catch(() => undefined)
}

function persistTopicSourcePreview(
  queryClient: ReturnType<typeof useQueryClient>,
  target: AuthenticatedTarget,
  message: ClientMessage
) {
  const topic = queryClient
    .getQueryData<ClientConversation[]>(queryKeys.conversations(target))
    ?.find(
      (conversation) =>
        conversation.id === message.conversationId &&
        conversation.type === "topic"
    )?.topic
  if (!topic) return

  void messageManager.updateTopicSourcePreview(target, {
    message,
    parentConversationId: topic.parentConversationId,
    sourceMessageId: topic.sourceMessageId,
  })
}

export function useMarkConversationRead(
  server: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (upToSeq: number) =>
      messageManager.markRead(server, conversationId, upToSeq),
    onMutate: (upToSeq) => {
      void queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(server),
      })
      void conversationManager.patch(server, conversationId, {
        lastReadSeq: upToSeq,
        unreadCount: 0,
      })
    },
    onError: () => {
      void conversationManager.refresh(server).catch(() => undefined)
    },
    onSuccess: async (result) => {
      await conversationManager.patch(
        server,
        result.conversationId,
        (conversation) => mergeConversationReadResult(conversation, result)
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
        ? preserveNewerMessageState(current, message)
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
          ? preserveNewerMessageState(previous, message)
          : message
      }),
    })),
  }
  return replaceEqualDeep(current, merged)
}
