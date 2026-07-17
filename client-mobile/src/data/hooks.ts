import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  login,
  loginWithEmailCode,
  requestEmailLoginCode,
} from "@/data/auth-api"
import {
  appInfoQueryOptions,
  queryKeys,
  type ServerTarget,
} from "@/data/query"

export function useCachedAppInfo(server: ServerTarget) {
  return useQuery({
    ...appInfoQueryOptions(server),
    enabled: false,
  })
}

export function useLoginMutation(server: ServerTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { account: string; password: string }) =>
      login(server.url, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.appInfo(server),
        refetchType: "none",
      }),
  })
}

export function useEmailCodeLoginMutation(server: ServerTarget) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { code: string; email: string }) =>
      loginWithEmailCode(server.url, input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.appInfo(server),
        refetchType: "none",
      }),
  })
}

export function useRequestEmailCodeMutation(server: ServerTarget) {
  return useMutation({
    mutationFn: (email: string) => requestEmailLoginCode(server.url, email),
  })
}
