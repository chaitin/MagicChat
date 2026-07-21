import type { InfiniteData, QueryClient } from "@tanstack/react-query"

import type {
  ClientConversation,
  ClientMessage,
  ClientMessageList,
} from "@/data/models"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"

type MessageInfiniteData = InfiniteData<ClientMessageList, number | null>

export function updateCachedMessageTopic(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  input: {
    archived: boolean
    conversationId: string
    parentConversationId: string
    sourceMessageId: string
  }
) {
  queryClient.setQueryData<MessageInfiniteData>(
    queryKeys.conversationMessages(target, input.parentConversationId),
    (current) =>
      mapCachedMessage(current, input.sourceMessageId, (message) => ({
        ...message,
        topic: {
          archived: input.archived,
          conversationId: input.conversationId,
          recentReplies: message.topic?.recentReplies ?? [],
        },
      }))
  )
}

export function updateCachedTopicSourcePreview(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  message: ClientMessage
) {
  const senderType = message.sender.type
  if (senderType === "system") return
  const sender = { id: message.sender.id, type: senderType }

  const conversations = queryClient.getQueryData<ClientConversation[]>(
    queryKeys.conversations(target)
  )
  const topic = conversations?.find(
    (conversation) =>
      conversation.id === message.conversationId &&
      conversation.type === "topic"
  )?.topic
  if (!topic) return

  queryClient.setQueryData<MessageInfiniteData>(
    queryKeys.conversationMessages(target, topic.parentConversationId),
    (current) =>
      mapCachedMessage(current, topic.sourceMessageId, (sourceMessage) => {
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
      })
  )
}

function mapCachedMessage(
  current: MessageInfiniteData | undefined,
  messageId: string,
  update: (message: ClientMessage) => ClientMessage
) {
  if (!current) return current

  let changed = false
  const pages = current.pages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      if (message.id !== messageId) return message
      changed = true
      return update(message)
    }),
  }))

  return changed ? { ...current, pages } : current
}
