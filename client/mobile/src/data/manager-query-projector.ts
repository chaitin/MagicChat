import type { QueryClient } from "@tanstack/react-query"

import type { ClientConversation } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { ContactSnapshot } from "@/data/contacts"
import type { ProjectSnapshot } from "@/data/projects"
import { queryKeys } from "@/data/query"

type QueryProjector = Pick<QueryClient, "setQueryData">

/** Rebuilds the contacts-related Query projections from the manager snapshot. */
export function projectContactsSnapshot(
  queryClient: QueryProjector,
  target: AuthenticatedTarget,
  snapshot: ContactSnapshot
) {
  queryClient.setQueryData(queryKeys.contacts(target), snapshot.directory)
  queryClient.setQueryData(queryKeys.userProfiles(target), snapshot.usersById)
}

/** Rebuilds the conversation list Query projection from manager-owned state. */
export function projectConversationsSnapshot(
  queryClient: QueryProjector,
  target: AuthenticatedTarget,
  conversations: ClientConversation[]
) {
  queryClient.setQueryData(queryKeys.conversations(target), conversations)
}

/** Rebuilds the projects infinite-query projection from the manager snapshot. */
export function projectProjectsSnapshot(
  queryClient: QueryProjector,
  target: AuthenticatedTarget,
  snapshot: ProjectSnapshot
) {
  queryClient.setQueryData(queryKeys.projects(target), {
    pageParams: snapshot.pages.map((_, index) =>
      index === 0 ? null : snapshot.pages[index - 1]?.nextCursor
    ),
    pages: snapshot.pages,
  })
}
