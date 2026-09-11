import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  login,
  loginWithEmailCode,
  requestEmailLoginCode,
} from "@/data/auth/auth-api"
import {
  appInfoQueryOptions,
  queryKeys,
} from "@/data/query"
import type { ServerTarget } from "@/core/server-target"
import { useAuth } from "@/providers/auth-provider"

export function useAppInfoQuery(server: ServerTarget, enabled = true) {
  return useQuery({
    ...appInfoQueryOptions(server),
    enabled,
  })
}

export function useCachedAppInfo(server: ServerTarget) {
  return useQuery({
    ...appInfoQueryOptions(server),
    enabled: false,
  })
}

export function useLoginMutation(server: ServerTarget) {
  const queryClient = useQueryClient()
  const { installAndActivate } = useAuth()

  return useMutation({
    mutationFn: (input: { account: string; password: string }) => {
      let credential: Parameters<typeof installAndActivate>[2] | undefined
      return login(server.url, input, { onMobileSession: (value) => { credential = value } })
        .then(async (user) => {
          if (!credential) throw new Error("登录凭据不可用")
          await installAndActivate(server, user, credential)
          return user
        })
    },
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
  const { installAndActivate } = useAuth()

  return useMutation({
    mutationFn: (input: { code: string; email: string }) => {
      let credential: Parameters<typeof installAndActivate>[2] | undefined
      return loginWithEmailCode(server.url, input, { onMobileSession: (value) => { credential = value } })
        .then(async (user) => {
          if (!credential) throw new Error("登录凭据不可用")
          await installAndActivate(server, user, credential)
          return user
        })
    },
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
