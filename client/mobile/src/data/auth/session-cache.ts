import type { QueryClient } from "@tanstack/react-query"

import type {
  AuthenticatedTarget,
  ServerTarget,
} from "@/core/server-target"
import { queryKeys } from "@/data/query"

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
