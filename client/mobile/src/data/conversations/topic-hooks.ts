import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  archiveConversationTopic,
  createConversationTopic,
  fetchConversationTopic,
} from "@/data/conversations/conversations-api"
import { conversationManager } from "@/data/conversations/index"
import { messageManager } from "@/data/messages"
import type { ClientConversation, ClientTopicDetail } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"

export function useConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: enabled && conversationId.length > 0,
    queryFn: ({ signal }) =>
      fetchConversationTopic(target, conversationId, { signal }),
    queryKey: queryKeys.conversationTopic(target, conversationId),
  })
}

export function useCreateConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (messageId: string) =>
      createConversationTopic(target, conversationId, messageId),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: async ({ conversation }, messageId, context) => {
      await persistTopicConversation(target, conversation, context?.startedAt)
      const topic = conversation.topic
      if (topic) {
        void messageManager.updateMessageTopic(target, {
          archived: false,
          conversationId: conversation.id,
          parentConversationId: conversationId,
          sourceMessageId: messageId,
        })
      }
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(target, conversationId),
      })
    },
  })
}

export function useArchiveConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => archiveConversationTopic(target, conversationId),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: async (conversation, _variables, context) => {
      await persistTopicConversation(target, conversation, context?.startedAt)
      const topic = conversation.topic

      queryClient.setQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, conversationId),
        (current) =>
          current
            ? {
                ...current,
                canArchive: false,
                canParticipate: false,
                conversation,
              }
            : current
      )
      if (topic) {
        void messageManager.updateMessageTopic(target, {
          archived: true,
          conversationId,
          parentConversationId: topic.parentConversationId,
          sourceMessageId: topic.sourceMessageId,
        })
      }

      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(target, conversationId),
      })
    },
  })
}

async function persistTopicConversation(
  target: AuthenticatedTarget,
  conversation: ClientConversation,
  startedAt?: number
) {
  try {
    await conversationManager.upsert(target, conversation, { startedAt })
  } catch {
    void conversationManager.refresh(target).catch(() => undefined)
  }
}
