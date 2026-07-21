import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  archiveConversationTopic,
  fetchConversationTopic,
} from "@/data/conversations-api"
import type {
  ClientConversation,
  ClientTopicDetail,
} from "@/data/models"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"
import { updateCachedMessageTopic } from "@/data/topic-cache"

export function useConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string,
  enabled: boolean
) {
  return useQuery({
    enabled: enabled && conversationId.length > 0,
    queryFn: ({ signal }) =>
      fetchConversationTopic(target.url, conversationId, { signal }),
    queryKey: queryKeys.conversationTopic(target, conversationId),
  })
}

export function useArchiveConversationTopic(
  target: AuthenticatedTarget,
  conversationId: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => archiveConversationTopic(target.url, conversationId),
    onSuccess: (conversation) => {
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
            : {
                canArchive: false,
                canParticipate: false,
                conversation,
              }
      )
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) =>
          current?.filter((item) => item.id !== conversationId)
      )

      if (topic) {
        updateCachedMessageTopic(queryClient, target, {
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
