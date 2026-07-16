import type { QueryClient } from "@tanstack/react-query"

import {
  queryKeys,
  type AuthenticatedTarget,
  type ServerTarget,
} from "@/data/query"

export async function clearAuthenticatedServerData(
  queryClient: QueryClient,
  server: ServerTarget
) {
  const queryKey = queryKeys.authenticatedServer(server)

  await queryClient.cancelQueries({ queryKey })
  queryClient.removeQueries({ queryKey })
}

export async function clearSessionData(
  queryClient: QueryClient,
  session: AuthenticatedTarget
) {
  await clearAuthenticatedServerData(queryClient, session)

  await queryClient.cancelQueries({
    exact: true,
    queryKey: queryKeys.appInfo(session),
  })
  queryClient.removeQueries({
    exact: true,
    queryKey: queryKeys.appInfo(session),
  })
}
