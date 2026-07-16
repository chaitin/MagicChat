import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  joinGroupConversation,
  openAppConversation,
  openDirectConversation,
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
