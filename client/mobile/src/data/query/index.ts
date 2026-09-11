import {
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from "@tanstack/react-query"

import { fetchAppInfo } from "@/data/auth/app-info-api"
import { contactManager } from "@/data/contacts"
import { conversationManager } from "@/data/conversations/index"
import { fetchCurrentUser } from "@/data/users/current-user-api"
import type { ClientProjectPage } from "@/core/models"
import { projectManager } from "@/data/projects"
import { createAuthenticatedScopeKey, createServerKey } from "@/data/server-key"
import type {
  AuthenticatedTarget,
  ServerTarget,
} from "@/core/server-target"

export const PROJECT_PAGE_SIZE = 100

type PeriodicQueryOptions = {
  refetchInterval?: false | number
}

function serverQueryKey(server: ServerTarget) {
  // Use the same canonical server identity as SQLite and Managers. In
  // particular, spelling-only URL differences must not create a new scope.
  return ["server", createServerKey(server)] as const
}

function authenticatedQueryKey(target: AuthenticatedTarget) {
  return ["authenticated", ...createAuthenticatedScopeKey(target)] as const
}

export const queryKeys = {
  server: serverQueryKey,
  appInfo: (server: ServerTarget) =>
    [...serverQueryKey(server), "app-info"] as const,
  authenticated: authenticatedQueryKey,
  authenticatedServer: (server: ServerTarget) =>
    [...serverQueryKey(server), "user"] as const,
  contacts: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "contacts"] as const,
  conversations: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "conversations"] as const,
  conversationMessages: (
    target: AuthenticatedTarget,
    conversationId: string
  ) =>
    [
      ...authenticatedQueryKey(target),
      "conversation",
      conversationId,
      "messages",
    ] as const,
  conversationTopic: (
    target: AuthenticatedTarget,
    conversationId: string
  ) =>
    [
      ...authenticatedQueryKey(target),
      "conversation",
      conversationId,
      "topic",
    ] as const,
  currentUser: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "current-user"] as const,
  userProfiles: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "user-profiles"] as const,
  projects: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "projects"] as const,
  avatarResource: (server: ServerTarget, sourceUrl: string) =>
    [...serverQueryKey(server), "resource", "avatar", sourceUrl] as const,
}

export function createClientQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
      },
    },
  })
}

export function appInfoQueryOptions(server: ServerTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchAppInfo(server.url, { signal }),
    queryKey: queryKeys.appInfo(server),
    retry: false,
    staleTime: 0,
  })
}

export function contactsQueryOptions(
  target: AuthenticatedTarget,
  options: PeriodicQueryOptions = {}
) {
  return queryOptions({
    queryFn: () => contactManager.getSnapshot(target).then((value) => value.directory),
    queryKey: queryKeys.contacts(target),
    refetchInterval: options.refetchInterval,
  })
}

export function currentUserQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchCurrentUser(target, { signal }),
    queryKey: queryKeys.currentUser(target),
  })
}

export function conversationsQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: () => conversationManager.list(target),
    queryKey: queryKeys.conversations(target),
  })
}

export function projectsQueryOptions(
  target: AuthenticatedTarget,
  options: PeriodicQueryOptions = {}
) {
  return infiniteQueryOptions({
    getNextPageParam: (lastPage: ClientProjectPage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      projectManager.getSnapshot(target).then((snapshot) => {
        const page = pageParam === null
          ? snapshot.pages[0]
          : snapshot.pages[
              snapshot.pages.findIndex(
                (_, pageIndex) =>
                  snapshot.pages[pageIndex - 1]?.nextCursor === pageParam
              )
            ]
        if (!page) throw new Error(`项目分页缓存中不存在 cursor: ${String(pageParam)}`)
        return page
      }),
    queryKey: queryKeys.projects(target),
    refetchInterval: options.refetchInterval,
  })
}
