import {
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from "@tanstack/react-query"

import { fetchAppInfo } from "@/data/app-info-api"
import { fetchContacts } from "@/data/contacts-api"
import { fetchConversations } from "@/data/conversations-api"
import { fetchCurrentUser } from "@/data/current-user-api"
import type { ClientProjectPage } from "@/data/models"
import { fetchProjects } from "@/data/projects-api"

export const CLIENT_DATA_REFRESH_INTERVAL_MS = 15_000
export const PROJECT_PAGE_SIZE = 100

export type ServerTarget = {
  id: string
  url: string
}

export type AuthenticatedTarget = ServerTarget & {
  userId: string
}

function serverQueryKey(server: ServerTarget) {
  return ["server", server.id, server.url] as const
}

function authenticatedQueryKey(target: AuthenticatedTarget) {
  return [...serverQueryKey(target), "user", target.userId] as const
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
  currentUser: (target: AuthenticatedTarget) =>
    [...authenticatedQueryKey(target), "current-user"] as const,
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

export function contactsQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchContacts(target.url, { signal }),
    queryKey: queryKeys.contacts(target),
    refetchInterval: CLIENT_DATA_REFRESH_INTERVAL_MS,
  })
}

export function currentUserQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchCurrentUser(target.url, { signal }),
    queryKey: queryKeys.currentUser(target),
  })
}

export function conversationsQueryOptions(target: AuthenticatedTarget) {
  return queryOptions({
    queryFn: ({ signal }) => fetchConversations(target.url, { signal }),
    queryKey: queryKeys.conversations(target),
    refetchInterval: CLIENT_DATA_REFRESH_INTERVAL_MS,
  })
}

export function projectsQueryOptions(target: AuthenticatedTarget) {
  return infiniteQueryOptions({
    getNextPageParam: (lastPage: ClientProjectPage) =>
      lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchProjects(
        target.url,
        {
          cursor: pageParam ?? undefined,
          limit: PROJECT_PAGE_SIZE,
        },
        { signal }
      ),
    queryKey: queryKeys.projects(target),
    refetchInterval: CLIENT_DATA_REFRESH_INTERVAL_MS,
  })
}
