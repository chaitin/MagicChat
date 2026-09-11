import type { QueryClient } from "@tanstack/react-query"

import type { ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { isUnauthorizedError } from "@/data/api-client"
import { contactManager } from "@/data/contacts"
import {
  projectContactsSnapshot,
  projectProjectsSnapshot,
} from "@/data/manager-query-projector"
import { cacheBootstrappedConversationMessages } from "@/data/messages/message-query-cache"
import { projectManager } from "@/data/projects"
import { currentUserQueryOptions, queryKeys } from "@/data/query"
import { LOGIN_BOOTSTRAP_MAX_ATTEMPTS } from "@/features/auth/login-bootstrap-constants"
import { runClientMessageBootstrap } from "@/features/bootstrap/client-message-bootstrap"
import { SessionBootstrapCoordinator, type SessionBootstrapOperations } from "@/features/bootstrap/session-bootstrap-coordinator"

export const sessionBootstrapCoordinator = new SessionBootstrapCoordinator(isUnauthorizedError)

export function createSessionBootstrapOperations({
  queryClient,
  target,
}: {
  queryClient: QueryClient
  target: AuthenticatedTarget
}): SessionBootstrapOperations {
  return {
    messages: async ({ isCurrent }) => {
      const publishPage = (conversationId: string, page: ClientMessageList) => {
        if (isCurrent()) cacheBootstrappedConversationMessages(queryClient, target, new Map([[conversationId, page]]))
      }
      const pages = await runClientMessageBootstrap(target, publishPage)
      if (isCurrent()) cacheBootstrappedConversationMessages(queryClient, target, pages)
    },
    contacts: async ({ isCurrent }) => {
      const snapshot = await contactManager.getSnapshot(target)
      if (!isCurrent()) return
      projectContactsSnapshot(queryClient, target, snapshot)
    },
    currentUser: async ({ isCurrent }) => {
      const user = await queryClient.fetchQuery({
        ...currentUserQueryOptions(target),
        retry: LOGIN_BOOTSTRAP_MAX_ATTEMPTS - 1,
      })
      if (!isCurrent()) queryClient.removeQueries({ queryKey: queryKeys.currentUser(target), exact: true })
      return user
    },
    projects: async ({ isCurrent }) => {
      const snapshot = await projectManager.getSnapshot(target)
      if (!isCurrent()) return
      projectProjectsSnapshot(queryClient, target, snapshot)
    },
  }
}
