import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import {
  addGroupConversationMembers as addGroupConversationMembersRequest,
  createGroupConversation as createGroupConversationRequest,
  dismissConversation as dismissConversationRequest,
  dissolveGroupConversation as dissolveGroupConversationRequest,
  joinGroupConversation,
  leaveGroupConversation as leaveGroupConversationRequest,
  openAppConversation,
  openDirectConversation,
  restoreConversation,
  setConversationMuted as setConversationMutedRequest,
  setConversationPinned as setConversationPinnedRequest,
  updateGroupConversationAnnouncement as updateGroupConversationAnnouncementRequest,
  updateGroupConversationName as updateGroupConversationNameRequest,
} from "@/data/conversations/conversations-api"
import { conversationManager } from "@/data/conversations/index"
import { contactManager } from "@/data/contacts"
import type {
  ClientConversation,
  ClientTopicDetail,
} from "@/core/models"
import { messageManager } from "@/data/messages"
import type { AuthenticatedTarget } from "@/core/server-target"
import { queryKeys } from "@/data/query"

export type OpenEntityConversationInput = {
  id: string
  joined?: boolean
  type: "user" | "app" | "group"
}

export function useOpenEntityConversation(target: AuthenticatedTarget) {
  return useMutation({
    mutationFn: (input: OpenEntityConversationInput) => {
      if (input.type === "user") {
        return openDirectConversation(target, input.id)
      }
      if (input.type === "app") {
        return openAppConversation(target, input.id)
      }
      return input.joined
        ? restoreConversation(target, input.id)
        : joinGroupConversation(target, input.id)
    },
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: async (conversation, input, context) => {
      await persistConversationChange(target, () =>
        conversationManager.upsert(target, conversation, {
          startedAt: context?.startedAt,
        })
      )

      if (
        input.type === "group" &&
        (await conversationManager.get(target, conversation.id).catch(() => null))
      ) {
        await persistContactChange(target, () =>
          upsertConversationGroup(target, conversation)
        )
      }
    },
  })
}

export function useSetConversationPinned(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; pinned: boolean }) =>
      setConversationPinnedRequest(
        target,
        input.conversationId,
        input.pinned
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient
        .getQueryData<ClientConversation[]>(queryKeys.conversations(target))
        ?.find((conversation) => conversation.id === input.conversationId)
      const previousTopic = queryClient.getQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, input.conversationId)
      )
      await updateCachedConversation(queryClient, target, input.conversationId, {
        pinned: input.pinned,
      })
      return { previous, previousTopic }
    },
    onError: async (_error, input, context) => {
      if (context?.previous) {
        await rollbackCachedConversation(
          target,
          input.conversationId,
          "pinned",
          input.pinned,
          context.previous.pinned
        )
      }
      rollbackTopicConversationField(
        queryClient,
        target,
        input.conversationId,
        "pinned",
        input.pinned,
        context?.previousTopic?.conversation.pinned
      )
    },
    onSuccess: async (result) => {
      await persistConversationChange(target, () =>
        updateCachedConversation(queryClient, target, result.conversationId, {
          pinned: result.pinned,
        })
      )
    },
  })
}

export function useSetConversationMuted(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; muted: boolean }) =>
      setConversationMutedRequest(
        target,
        input.conversationId,
        input.muted
      ),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.conversations(target),
      })
      const previous = queryClient
        .getQueryData<ClientConversation[]>(queryKeys.conversations(target))
        ?.find((conversation) => conversation.id === input.conversationId)
      const previousTopic = queryClient.getQueryData<ClientTopicDetail>(
        queryKeys.conversationTopic(target, input.conversationId)
      )
      await updateCachedConversation(queryClient, target, input.conversationId, {
        notificationMuted: input.muted,
      })
      return { previous, previousTopic }
    },
    onError: async (_error, input, context) => {
      if (context?.previous) {
        await rollbackCachedConversation(
          target,
          input.conversationId,
          "notificationMuted",
          input.muted,
          context.previous.notificationMuted
        )
      }
      rollbackTopicConversationField(
        queryClient,
        target,
        input.conversationId,
        "notificationMuted",
        input.muted,
        context?.previousTopic?.conversation.notificationMuted
      )
    },
    onSuccess: async (result) => {
      await persistConversationChange(target, () =>
        updateCachedConversation(queryClient, target, result.conversationId, {
          notificationMuted: result.muted,
        })
      )
    },
  })
}

export function useAddGroupConversationMembers(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; memberIds: string[] }) =>
      addGroupConversationMembersRequest(
        target,
        input.conversationId,
        input.memberIds
      ),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: (conversation, _input, context) =>
      updateGroupConversationCache(
        queryClient,
        target,
        conversation,
        context?.startedAt
      ),
  })
}

export function useCreateGroupConversation(target: AuthenticatedTarget) {
  return useMutation({
    mutationFn: (memberIds: string[]) =>
      createGroupConversationRequest(target, memberIds),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: async (conversation, _memberIds, context) => {
      await persistConversationChange(target, () =>
        conversationManager.upsert(target, conversation, {
          startedAt: context?.startedAt,
        })
      )
      await persistContactChange(target, () =>
        upsertConversationGroup(target, conversation)
      )
    },
  })
}

export function useUpdateGroupConversationName(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { conversationId: string; name: string }) =>
      updateGroupConversationNameRequest(
        target,
        input.conversationId,
        input.name
      ),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: (conversation, _input, context) =>
      updateGroupConversationCache(
        queryClient,
        target,
        conversation,
        context?.startedAt
      ),
  })
}

export function useUpdateGroupConversationAnnouncement(
  target: AuthenticatedTarget
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { announcement: string; conversationId: string }) =>
      updateGroupConversationAnnouncementRequest(
        target,
        input.conversationId,
        input.announcement
      ),
    onMutate: () => ({ startedAt: conversationManager.beginOperation(target) }),
    onSuccess: (conversation, _input, context) =>
      updateGroupConversationCache(
        queryClient,
        target,
        conversation,
        context?.startedAt
      ),
  })
}

export function useLeaveGroupConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      leaveGroupConversationRequest(target, conversationId),
    onSuccess: async (result) => {
      await persistConversationChange(target, () =>
        removeConversationFromCache(queryClient, target, result.conversationId)
      )
      await persistContactChange(target, () =>
        contactManager.patchGroup(target, result.conversationId, {
          joined: false,
        })
      )
    },
  })
}

export function useDissolveGroupConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      dissolveGroupConversationRequest(target, conversationId),
    onSuccess: async (result) => {
      await persistConversationChange(target, () =>
        removeConversationFromCache(
          queryClient,
          target,
          result.conversationId,
          true
        )
      )
      await persistContactChange(target, () =>
        contactManager.removeGroup(target, result.conversationId)
      )
    },
  })
}

export function useDismissConversation(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) =>
      dismissConversationRequest(target, conversationId),
    onSuccess: (result) =>
      persistConversationChange(target, () =>
        removeConversationFromCache(queryClient, target, result.conversationId)
      ),
  })
}

async function updateGroupConversationCache(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversation: ClientConversation,
  startedAt?: number
) {
  await persistConversationChange(target, () =>
    conversationManager.upsert(target, conversation, { startedAt })
  )
  await persistContactChange(target, () =>
    upsertConversationGroup(target, conversation)
  )
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: queryKeys.conversationMessages(target, conversation.id),
  })
}

async function upsertConversationGroup(
  target: AuthenticatedTarget,
  conversation: ClientConversation
) {
  const snapshot = await contactManager.getSnapshot(target)
  const existing = snapshot.directory.groups.find(
    (group) => group.id === conversation.id
  )
  await contactManager.upsertGroup(target, {
    avatar: conversation.avatar,
    avatarMembers: conversation.members
      ? conversation.members.map((member) => ({
          avatar: member.avatar,
          id: member.id,
          name: member.name,
          nickname: member.nickname,
          role: member.role,
          type: member.type,
        }))
      : (existing?.avatarMembers ?? []),
    id: conversation.id,
    joined: true,
    memberCount: conversation.memberCount,
    name: conversation.name,
    type: "group",
    visibility: conversation.visibility,
  })
}

async function removeConversationFromCache(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  removeTree = false
) {
  if (removeTree) {
    await conversationManager.removeTree(target, conversationId)
  } else {
    await conversationManager.remove(target, conversationId)
  }
  await messageManager.clearConversation(target, conversationId)
  queryClient.removeQueries({
    exact: true,
    queryKey: queryKeys.conversationMessages(target, conversationId),
  })
}

async function persistConversationChange(
  target: AuthenticatedTarget,
  write: () => Promise<unknown>
) {
  try {
    await write()
  } catch {
    void conversationManager.refresh(target).catch(() => undefined)
  }
}

async function persistContactChange(
  target: AuthenticatedTarget,
  write: () => Promise<unknown>
) {
  try {
    await write()
  } catch {
    void contactManager.refresh(target).catch(() => undefined)
  }
}

async function rollbackCachedConversation<
  TField extends "notificationMuted" | "pinned",
>(
  target: AuthenticatedTarget,
  conversationId: string,
  field: TField,
  optimisticValue: ClientConversation[TField],
  previousValue: ClientConversation[TField]
) {
  await conversationManager.patch(target, conversationId, (current) =>
    current[field] === optimisticValue ? { [field]: previousValue } : {}
  )
}

function rollbackTopicConversationField<
  TField extends "notificationMuted" | "pinned",
>(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  field: TField,
  optimisticValue: ClientConversation[TField],
  previousValue: ClientConversation[TField] | undefined
) {
  if (previousValue === undefined) return
  queryClient.setQueryData<ClientTopicDetail>(
    queryKeys.conversationTopic(target, conversationId),
    (current) =>
      current?.conversation[field] === optimisticValue
        ? {
            ...current,
            conversation: {
              ...current.conversation,
              [field]: previousValue,
            },
          }
        : current
  )
}

async function updateCachedConversation(
  queryClient: QueryClient,
  target: AuthenticatedTarget,
  conversationId: string,
  updates: Partial<Pick<ClientConversation, "notificationMuted" | "pinned">>
) {
  const updated = await conversationManager.patch(
    target,
    conversationId,
    updates
  )
  if (!updated) {
    void conversationManager.refresh(target).catch(() => undefined)
  }
  queryClient.setQueryData<ClientTopicDetail>(
    queryKeys.conversationTopic(target, conversationId),
    (current) =>
      current
        ? {
            ...current,
            conversation: { ...current.conversation, ...updates },
          }
        : current
  )
}
