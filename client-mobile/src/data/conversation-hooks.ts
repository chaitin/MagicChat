import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import {
  dismissConversation as dismissConversationRequest,
  joinGroupConversation,
  openAppConversation,
  openDirectConversation,
  setConversationMuted as setConversationMutedRequest,
  setConversationPinned as setConversationPinnedRequest,
} from "@/data/conversations-api"
import type { ClientContacts, ClientConversation } from "@/data/models"
import { queryKeys, type AuthenticatedTarget } from "@/data/query"

export type OpenEntityConversationInput = {
  id: string
  type: "user" | "app" | "group"
}

export function useOpenEntityConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OpenEntityConversationInput) => {
      if (input.type === "user") {
        return openDirectConversation(target.url, input.id)
      }
      if (input.type === "app") {
        return openAppConversation(target.url, input.id)
      }
      return joinGroupConversation(target.url, input.id)
    },
    onSuccess: (conversation, input) => {
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) => upsertConversation(current, conversation)
      )

      if (input.type === "group") {
        queryClient.setQueryData<ClientContacts>(
          queryKeys.contacts(target),
          (current) => markGroupJoined(current, conversation)
        )
        void queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.contacts(target),
        })
      }
    },
  })
}

export function useSetConversationPinned(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; pinned: boolean }) =>
      setConversationPinnedRequest(
        target.url,
        input.conversationId,
        input.pinned
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient.getQueryData<ClientConversation[]>(
        queryKeys.conversations(target)
      )
      updateCachedConversation(queryClient, target, input.conversationId, {
        pinned: input.pinned,
      })
      return { previous }
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(
        queryKeys.conversations(target),
        context?.previous
      )
    },
    onSuccess: (result) => {
      updateCachedConversation(queryClient, target, result.conversationId, {
        pinned: result.pinned,
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      }),
  })
}

export function useSetConversationMuted(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; muted: boolean }) =>
      setConversationMutedRequest(
        target.url,
        input.conversationId,
        input.muted
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient.getQueryData<ClientConversation[]>(
        queryKeys.conversations(target)
      )
      updateCachedConversation(queryClient, target, input.conversationId, {
        notificationMuted: input.muted,
      })
      return { previous }
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(
        queryKeys.conversations(target),
        context?.previous
      )
    },
    onSuccess: (result) => {
      updateCachedConversation(queryClient, target, result.conversationId, {
        notificationMuted: result.muted,
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      }),
  })
}

export function useDismissConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      dismissConversationRequest(target.url, conversationId),
    onSuccess: (result) => {
      queryClient.setQueryData<ClientConversation[]>(
        queryKeys.conversations(target),
        (current) =>
          current?.filter(
            (conversation) => conversation.id !== result.conversationId
          )
      )
      queryClient.removeQueries({
        exact: true,
        queryKey: queryKeys.conversationMessages(
          target,
          result.conversationId
        ),
      })
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
    },
  })
}

function upsertConversation(
  conversations: ClientConversation[] | undefined,
  conversation: ClientConversation
) {
  const currentConversation = conversations?.find(
    (item) => item.id === conversation.id
  )
  const nextConversation =
    conversation.projects === undefined && currentConversation?.projects
      ? { ...conversation, projects: currentConversation.projects }
      : conversation

  return [
    nextConversation,
    ...(conversations ?? []).filter((item) => item.id !== conversation.id),
  ]
}

function updateCachedConversation(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  updates: Partial<Pick<ClientConversation, "notificationMuted" | "pinned">>
) {
  queryClient.setQueryData<ClientConversation[]>(
    queryKeys.conversations(target),
    (current) =>
      current?.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, ...updates }
          : conversation
      )
  )
}

function markGroupJoined(
  contacts: ClientContacts | undefined,
  conversation: ClientConversation
) {
  if (!contacts) return contacts

  return {
    ...contacts,
    groups: contacts.groups.map((group) =>
      group.id === conversation.id
        ? {
            ...group,
            joined: true,
            memberCount: conversation.memberCount || group.memberCount,
          }
        : group
    ),
  }
}
