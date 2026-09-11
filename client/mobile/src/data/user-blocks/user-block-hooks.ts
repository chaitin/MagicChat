import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError } from "@/data/api-client"
import {
  blockUser,
  getUserBlockStatus,
  type UserBlockStatus,
  unblockUser,
} from "@/data/user-blocks/user-block-api"

export function userBlockStatusQueryKey(
  target: AuthenticatedTarget,
  userId: string
) {
  return ["user-block-status", target.id, target.url, target.userId, userId] as const
}

export function useUserBlockStatus(
  target: AuthenticatedTarget,
  userId: string,
  enabled: boolean
) {
  return useQuery({
    enabled,
    queryFn: () => getUserBlockStatus(target, userId),
    queryKey: userBlockStatusQueryKey(target, userId),
    retry: (failureCount, error) =>
      !(error instanceof ApiRequestError && error.status === 404) &&
      failureCount < 1,
  })
}

export function useSetUserBlocked(target: AuthenticatedTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { blocked: boolean; userId: string }) =>
      input.blocked
        ? blockUser(target, input.userId)
        : unblockUser(target, input.userId),
    onSuccess: (status: UserBlockStatus) => {
      queryClient.setQueryData(
        userBlockStatusQueryKey(target, status.userId),
        status
      )
    },
  })
}
