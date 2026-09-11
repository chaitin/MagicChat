import { useCallback, useEffect, useMemo } from "react"
import type { AuthenticatedTarget } from "@/core/server-target"
import { getClientDataPollingIntervals } from "@/data/query/fallback-polling"
import { useAuth } from "@/providers/auth-provider"
import { useRealtime } from "@/realtime/realtime-context"
import { getClientDataBootstrapState } from "@/providers/client-data-bootstrap"
import { ClientContactsContext, ClientConversationsContext, ClientDataStatusContext, ClientProjectsContext, ClientSessionContext } from "./context"
import { collectConversationUserIds, EMPTY_CONTACTS } from "./helpers"
import { combineClientDataState } from "./state"
import { useContactsController } from "./use-contacts-controller"
import { useConversationsController } from "./use-conversations-controller"
import { useMessagesController } from "./use-messages-controller"
import { useProjectsController } from "./use-projects-controller"
import { useSessionController } from "./use-session-controller"

const INACTIVE_TARGET: AuthenticatedTarget = { id: "inactive", url: "http://inactive.invalid", userId: "inactive" }
const EMPTY_CONVERSATIONS: never[] = []

export function ClientDataProvider({ children }: React.PropsWithChildren) {
  const { invalidateSession, isAuthenticated, session } = useAuth()
  const { ready: realtimeReady } = useRealtime()
  return <TargetClientDataProvider enabled={isAuthenticated} invalidateSession={invalidateSession} realtimeReady={realtimeReady} target={session ?? INACTIVE_TARGET}>{children}</TargetClientDataProvider>
}

function TargetClientDataProvider({ children, enabled, invalidateSession, realtimeReady, target }: React.PropsWithChildren<{ enabled: boolean; invalidateSession: () => Promise<void>; realtimeReady: boolean; target: AuthenticatedTarget }>) {
  const intervals = getClientDataPollingIntervals(realtimeReady)
  const session = useSessionController(target, enabled, invalidateSession)
  const contacts = useContactsController(target, enabled, intervals.contacts, session.unauthorized)
  const conversations = useConversationsController(target, enabled, intervals.conversations, contacts.data.apps, contacts.usersById, session.unauthorized)
  const projects = useProjectsController(target, enabled, intervals.projects, session.unauthorized)
  const messages = useMessagesController(session.bootstrapSnapshot.operations, enabled)
  const { ensureUsers, refresh: refreshContacts } = contacts
  const { rawData: rawConversations, refresh: refreshConversations } = conversations
  const { refresh: refreshProjects } = projects
  const { refresh: refreshSession } = session
  useEffect(() => { const ids = collectConversationUserIds(rawConversations); if (enabled && ids.length) queueMicrotask(() => void ensureUsers(ids).catch(() => undefined)) }, [enabled, ensureUsers, rawConversations])
  const bootstrap = getClientDataBootstrapState([
    { available: session.data !== undefined, error: session.error },
    { available: contacts.directory !== undefined, error: contacts.error },
    { available: conversations.localReady, error: conversations.error },
  ])
  const readiness = combineClientDataState({ enabled, currentUserAvailable: session.data !== undefined, contactsAvailable: contacts.directory !== undefined, conversationsAvailable: conversations.localReady, contactsLocalReady: contacts.localReady, conversationsLocalReady: conversations.localReady, profilesReady: contacts.profilesReady, bootstrapState: bootstrap })
  const refresh = useCallback(async () => { await Promise.all([refreshContacts(), refreshConversations(), refreshProjects()]) }, [refreshContacts, refreshConversations, refreshProjects])
  const refreshBootstrap = useCallback(async () => { await Promise.all([refreshSession(), refreshContacts(), refreshConversations()]) }, [refreshContacts, refreshConversations, refreshSession])
  const error = session.error ?? contacts.error ?? conversations.error ?? projects.error
  const sessionValue = useMemo(() => ({
    currentUser: enabled ? (session.data ?? null) : null,
    currentUserError: enabled ? session.error : null,
  }), [enabled, session.data, session.error])
  const contactsValue = useMemo(() => ({
    contacts: enabled ? contacts.data : EMPTY_CONTACTS, contactsError: enabled ? contacts.error : null,
    isContactsRefreshing: enabled && contacts.refreshState, refreshContacts, ensureUsers, usersById: contacts.usersById,
  }), [contacts.data, contacts.error, contacts.refreshState, contacts.usersById, enabled, ensureUsers, refreshContacts])
  const conversationsValue = useMemo(() => ({
    conversations: enabled ? conversations.data : EMPTY_CONVERSATIONS, conversationsError: enabled ? conversations.error : null,
    isConversationsRefreshing: enabled && conversations.refreshState, refreshConversations,
  }), [conversations.data, conversations.error, conversations.refreshState, enabled, refreshConversations])
  const projectsValue = useMemo(() => ({
    hasMoreProjects: enabled && projects.hasMore, isProjectsLoading: enabled && !projects.localReady,
    isProjectsLoadingMore: enabled && projects.loadingMore, isProjectsRefreshing: enabled && projects.refreshState,
    loadMoreProjects: projects.loadMore, personalProject: projects.personalProject, projects: projects.data,
    projectsError: enabled ? projects.error : null, refreshProjects,
  }), [enabled, projects.data, projects.error, projects.hasMore, projects.loadMore, projects.loadingMore, projects.localReady, projects.personalProject, projects.refreshState, refreshProjects])
  const statusValue = useMemo(() => ({
    blockingBootstrapError: readiness.blockingBootstrapError, bootstrapReady: readiness.bootstrapReady,
    error: enabled ? error : null, isBootstrapRefreshing: enabled && session.refreshState,
    isMessageBootstrapComplete: messages.localReady, isReady: readiness.isReady,
    isRefreshing: enabled && (contacts.refreshState || conversations.refreshState || projects.refreshState),
    refresh, refreshBootstrap,
  }), [contacts.refreshState, conversations.refreshState, enabled, error, messages.localReady, projects.refreshState, readiness.blockingBootstrapError, readiness.bootstrapReady, readiness.isReady, refresh, refreshBootstrap, session.refreshState])
  return <ClientSessionContext.Provider value={sessionValue}>
    <ClientContactsContext.Provider value={contactsValue}>
      <ClientConversationsContext.Provider value={conversationsValue}>
        <ClientProjectsContext.Provider value={projectsValue}>
          <ClientDataStatusContext.Provider value={statusValue}>{children}</ClientDataStatusContext.Provider>
        </ClientProjectsContext.Provider>
      </ClientConversationsContext.Provider>
    </ClientContactsContext.Provider>
  </ClientSessionContext.Provider>
}
