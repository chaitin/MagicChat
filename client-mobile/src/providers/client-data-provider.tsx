import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { isUnauthorizedError } from "@/data/api-client"
import type {
  ClientContacts,
  ClientConversation,
  ClientProjectPage,
  ClientProjectSummary,
  ClientUser,
} from "@/data/models"
import {
  contactsQueryOptions,
  conversationsQueryOptions,
  currentUserQueryOptions,
  projectsQueryOptions,
  type AuthenticatedTarget,
} from "@/data/query"
import { useAuth } from "@/features/auth/auth-context"

const EMPTY_CONTACTS: ClientContacts = {
  apps: [],
  groups: [],
  users: [],
}

const INACTIVE_TARGET: AuthenticatedTarget = {
  id: "inactive",
  url: "http://inactive.invalid",
  userId: "inactive",
}

type ClientDataContextValue = {
  contacts: ClientContacts
  contactsError: Error | null
  conversations: ClientConversation[]
  conversationsError: Error | null
  currentUser: ClientUser | null
  currentUserError: Error | null
  error: Error | null
  hasMoreProjects: boolean
  isContactsRefreshing: boolean
  isConversationsRefreshing: boolean
  isProjectsLoading: boolean
  isProjectsLoadingMore: boolean
  isProjectsRefreshing: boolean
  isReady: boolean
  isRefreshing: boolean
  loadMoreProjects: () => Promise<void>
  personalProject: ClientProjectSummary | null
  projects: ClientProjectSummary[]
  projectsError: Error | null
  refresh: () => Promise<void>
  refreshContacts: () => Promise<void>
  refreshConversations: () => Promise<void>
  refreshProjects: () => Promise<void>
}

const ClientDataContext = createContext<ClientDataContextValue | null>(null)

export function ClientDataProvider({ children }: React.PropsWithChildren) {
  const { invalidateSession, session } = useAuth()
  const target = session ?? INACTIVE_TARGET
  const enabled = session !== null
  const contactsQuery = useQuery({
    ...contactsQueryOptions(target),
    enabled,
  })
  const conversationsQuery = useQuery({
    ...conversationsQueryOptions(target),
    enabled,
  })
  const currentUserQuery = useQuery({
    ...currentUserQueryOptions(target),
    enabled,
  })
  const projectsQuery = useInfiniteQuery({
    ...projectsQueryOptions(target),
    enabled,
  })
  const [manualRefresh, setManualRefresh] = useState({
    contacts: false,
    conversations: false,
    projects: false,
  })
  const projectPages = enabled ? projectsQuery.data?.pages : undefined
  const projects = useMemo(() => mergeProjectPages(projectPages), [projectPages])
  const personalProject = projectPages?.[projectPages.length - 1]?.personalProject
  const error =
    currentUserQuery.error ??
    contactsQuery.error ??
    conversationsQuery.error ??
    projectsQuery.error

  useEffect(() => {
    if (isUnauthorizedError(error)) {
      void invalidateSession()
    }
  }, [error, invalidateSession])

  const refreshContacts = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, contacts: true }))
    try {
      const result = await contactsQuery.refetch()

      if (result.error) {
        throw result.error
      }
    } finally {
      setManualRefresh((current) => ({ ...current, contacts: false }))
    }
  }, [contactsQuery])

  const refreshConversations = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, conversations: true }))
    try {
      const result = await conversationsQuery.refetch()

      if (result.error) {
        throw result.error
      }
    } finally {
      setManualRefresh((current) => ({ ...current, conversations: false }))
    }
  }, [conversationsQuery])

  const refreshProjects = useCallback(async () => {
    setManualRefresh((current) => ({ ...current, projects: true }))
    try {
      const result = await projectsQuery.refetch()

      if (result.error) {
        throw result.error
      }
    } finally {
      setManualRefresh((current) => ({ ...current, projects: false }))
    }
  }, [projectsQuery])

  const loadMoreProjects = useCallback(async () => {
    if (!projectsQuery.hasNextPage || projectsQuery.isFetchingNextPage) {
      return
    }

    const result = await projectsQuery.fetchNextPage()
    if (result.error) {
      throw result.error
    }
  }, [projectsQuery])

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshContacts(),
      refreshConversations(),
      refreshProjects(),
    ])
  }, [refreshContacts, refreshConversations, refreshProjects])

  const value = useMemo(
    () => ({
      contacts: enabled ? (contactsQuery.data ?? EMPTY_CONTACTS) : EMPTY_CONTACTS,
      contactsError: enabled ? contactsQuery.error : null,
      conversations: enabled ? (conversationsQuery.data ?? []) : [],
      conversationsError: enabled ? conversationsQuery.error : null,
      currentUser: enabled ? (currentUserQuery.data ?? null) : null,
      currentUserError: enabled ? currentUserQuery.error : null,
      error: enabled ? error : null,
      hasMoreProjects: enabled && projectsQuery.hasNextPage,
      isContactsRefreshing: enabled && manualRefresh.contacts,
      isConversationsRefreshing: enabled && manualRefresh.conversations,
      isProjectsLoading: enabled && projectsQuery.isLoading,
      isProjectsLoadingMore: enabled && projectsQuery.isFetchingNextPage,
      isProjectsRefreshing: enabled && manualRefresh.projects,
      isReady:
        enabled &&
        currentUserQuery.data !== undefined &&
        contactsQuery.data !== undefined &&
        conversationsQuery.data !== undefined,
      isRefreshing:
        enabled &&
        (manualRefresh.contacts ||
          manualRefresh.conversations ||
          manualRefresh.projects),
      loadMoreProjects,
      personalProject: personalProject ?? null,
      projects,
      projectsError: enabled ? projectsQuery.error : null,
      refresh,
      refreshContacts,
      refreshConversations,
      refreshProjects,
    }),
    [
      contactsQuery.data,
      contactsQuery.error,
      conversationsQuery.data,
      conversationsQuery.error,
      currentUserQuery.data,
      currentUserQuery.error,
      enabled,
      error,
      loadMoreProjects,
      manualRefresh.contacts,
      manualRefresh.conversations,
      manualRefresh.projects,
      personalProject,
      projects,
      projectsQuery.error,
      projectsQuery.hasNextPage,
      projectsQuery.isFetchingNextPage,
      projectsQuery.isLoading,
      refresh,
      refreshContacts,
      refreshConversations,
      refreshProjects,
    ]
  )

  return (
    <ClientDataContext.Provider value={value}>
      {children}
    </ClientDataContext.Provider>
  )
}

export function useClientData() {
  const value = useContext(ClientDataContext)

  if (!value) {
    throw new Error("useClientData 必须在 ClientDataProvider 内使用")
  }

  return value
}

function mergeProjectPages(pages: ClientProjectPage[] | undefined) {
  const projectsById = new Map<string, ClientProjectSummary>()

  for (const page of pages ?? []) {
    for (const project of page.projects) {
      projectsById.set(project.id, project)
    }
  }

  return Array.from(projectsById.values())
}
