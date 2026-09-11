import { createContext, useContext, useMemo } from "react"

import type { ClientContacts, ClientConversation, ClientProjectSummary, ClientUser, ContactUser } from "@/core/models"

export type ClientSessionData = {
  currentUser: ClientUser | null
  currentUserError: Error | null
}

export type ClientContactsData = {
  contacts: ClientContacts
  contactsError: Error | null
  isContactsRefreshing: boolean
  refreshContacts: () => Promise<void>
  ensureUsers: (userIds: string[]) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}

export type ClientConversationsData = {
  conversations: ClientConversation[]
  conversationsError: Error | null
  isConversationsRefreshing: boolean
  refreshConversations: () => Promise<void>
}

export type ClientProjectsData = {
  hasMoreProjects: boolean
  isProjectsLoading: boolean
  isProjectsLoadingMore: boolean
  isProjectsRefreshing: boolean
  loadMoreProjects: () => Promise<void>
  personalProject: ClientProjectSummary | null
  projects: ClientProjectSummary[]
  projectsError: Error | null
  refreshProjects: () => Promise<void>
}

export type ClientDataStatus = {
  blockingBootstrapError: Error | null
  bootstrapReady: boolean
  error: Error | null
  isBootstrapRefreshing: boolean
  isMessageBootstrapComplete: boolean
  isReady: boolean
  isRefreshing: boolean
  refresh: () => Promise<void>
  refreshBootstrap: () => Promise<void>
}

export type ClientDataContextValue = ClientSessionData & ClientContactsData & ClientConversationsData & ClientProjectsData & ClientDataStatus

export const ClientSessionContext = createContext<ClientSessionData | null>(null)
export const ClientContactsContext = createContext<ClientContactsData | null>(null)
export const ClientConversationsContext = createContext<ClientConversationsData | null>(null)
export const ClientProjectsContext = createContext<ClientProjectsData | null>(null)
export const ClientDataStatusContext = createContext<ClientDataStatus | null>(null)

function required<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} 必须在 ClientDataProvider 内使用`)
  return value
}

export const useClientSession = () => required(useContext(ClientSessionContext), "useClientSession")
export const useClientContacts = () => required(useContext(ClientContactsContext), "useClientContacts")
export const useClientConversations = () => required(useContext(ClientConversationsContext), "useClientConversations")
export const useClientProjects = () => required(useContext(ClientProjectsContext), "useClientProjects")
export const useClientDataStatus = () => required(useContext(ClientDataStatusContext), "useClientDataStatus")

/** 兼容聚合接口；新调用方应优先使用上面的领域 hook。 */
export function useClientData(): ClientDataContextValue {
  const session = useClientSession()
  const contacts = useClientContacts()
  const conversations = useClientConversations()
  const projects = useClientProjects()
  const status = useClientDataStatus()
  return useMemo(() => ({ ...session, ...contacts, ...conversations, ...projects, ...status }), [contacts, conversations, projects, session, status])
}
