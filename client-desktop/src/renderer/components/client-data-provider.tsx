import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { matchPath, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"

import {
  ClientDataRequestError,
  dismissConversation as dismissConversationRequest,
  acceptFriendRequest as acceptFriendRequestRequest,
  cancelFriendRequest as cancelFriendRequestRequest,
  createFriendRequest as createFriendRequestRequest,
  deleteFriend as deleteFriendRequest,
  getCurrentClientUser,
  isClientMessageInitiatedByUser,
  listClientContacts,
  listFriendRequests,
  listClientConversations,
  listConversationMessageChoiceSnapshots,
  listConversationMessageReactionSnapshots,
  listConversationMessages,
  markConversationRead as markConversationReadRequest,
  setConversationMessageReaction as setConversationMessageReactionRequest,
  setConversationChoiceResponse as setConversationChoiceResponseRequest,
  setConversationMuted as setConversationMutedRequest,
  setConversationPinned as setConversationPinnedRequest,
  rejectFriendRequest as rejectFriendRequestRequest,
  resolveClientUsers,
  type ClientConversation,
  type ClientMessage,
  type ClientMessageTopic,
  type ClientUser,
  type ContactApp,
  type ContactDirectoryMode,
  type ContactGroup,
  type ContactUser,
  type FriendRequest,
  type MarkConversationReadOptions,
  type MessageReactionsUpdatedEvent,
  type MessageChoiceUpdatedEvent,
  type MessageReactionSnapshot,
  type MessageChoiceSnapshot,
} from "@/lib/client-data-api"
import {
  ClientDataContext,
  type ClientConversationMessageState,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import {
  createConversationMessageState,
  applyMessageChoiceSnapshot,
  applyMessageChoiceState,
  applyMessageReactionSnapshot,
  applyMessageReactionsUpdate,
  getClientDataErrorMessage,
  getMessageSummary,
  getNewestMessageSeq,
  mergeConversationMessages,
  mergePageWithAfterResult,
  mergePageWithBeforeResult,
  messagePageLimit,
  orderConversations,
  compactConversationMessageState,
  consumeConversationMessageFocus as consumeMessageFocusState,
  updatePageWithMessage,
} from "@/lib/client-data-state"
import {
  createClientProject as createClientProjectRequest,
  listClientProjects,
  type ClientProjectDetail,
  type ClientProjectSummary,
} from "@/lib/project-data-api"
import { ClientDataErrorPage } from "@/components/client-data-error-page"
import { ClientLoadingPage } from "@/components/client-loading-page"
import { useConversationActions } from "@/hooks/use-conversation-actions"
import { useConversationSenders } from "@/hooks/use-conversation-senders"
import { useConversationMessageRetention } from "@/hooks/use-conversation-message-retention"
import { useAppInfo } from "@/lib/app-info-context"
import { useDesktopTarget } from "@/hooks/use-desktop-target"
import { ClientUserDirectory } from "@/lib/client-user-directory"
import { startStaggeredRefresh } from "@/lib/staggered-refresh"
import { trackDiagnosticRefresh, updateDiagnosticData } from "@/lib/runtime-diagnostics"
import {
  classifyDiagnosticError,
  createDiagnosticId,
  recordRendererDiagnostic,
} from "@/lib/desktop-diagnostics"
import {
  DesktopMessageRepository,
  catchUpConversationMessages,
  getMessageCacheTarget,
  isMessageOperationCancelled,
  messageCacheTargetKey,
  MessageManager,
  prioritizeConversationSyncs,
  registerMessageCacheClearHandler,
  type MessageOperationToken,
} from "@/lib/messages"

type BootstrapState = "loading" | "ready" | "error"

const minimumBootstrapLoadingMs = 1_000
const refreshIntervalMs = 15_000
const reactionSnapshotBatchSize = 100
const choiceSnapshotBatchSize = 100
const maxReactionSnapshotCatchUpAttempts = 3
const messageCacheFallbackNotice = "本地消息缓存暂时不可用，已从服务器加载"

export function ClientDataProvider({
  children,
  workspaceErrorAction,
}: {
  children: ReactNode
  workspaceErrorAction?: ReactNode
}) {
  const target = useDesktopTarget()
  const targetKey = `${target.id}\u0000${target.normalizedUrl}\u0000${target.userId}`

  return (
    <ClientDataProviderForTarget key={targetKey} workspaceErrorAction={workspaceErrorAction}>
      {children}
    </ClientDataProviderForTarget>
  )
}

function ClientDataProviderForTarget({
  children,
  workspaceErrorAction,
}: {
  children: ReactNode
  workspaceErrorAction?: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { setAuthenticated } = useAppInfo()
  const [bootstrapError, setBootstrapError] = useState<ClientDataRequestError | null>(null)
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("loading")
  const [conversations, setConversations] = useState<ClientConversation[]>([])
  const [conversationMessageStates, setConversationMessageStates] = useState<
    Record<string, ClientConversationMessageState>
  >({})
  const [foregroundConversationId, setForegroundConversationIdState] = useState("")
  const routeConversationId =
    matchPath("/chat/:conversationId", location.pathname)?.params.conversationId ?? ""
  const includedConversationId = foregroundConversationId || routeConversationId
  const [contactApps, setContactApps] = useState<ContactApp[]>([])
  const [contactDirectoryMode, setContactDirectoryMode] =
    useState<ContactDirectoryMode>("organization")
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([])
  const [contactUserIds, setContactUserIds] = useState<string[]>([])
  const [usersById, setUsersById] = useState<Readonly<Record<string, ContactUser>>>({})
  const [contactsError, setContactsError] = useState<ClientDataRequestError | null>(null)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsRefreshing, setContactsRefreshing] = useState(false)
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequest[]>([])
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FriendRequest[]>([])
  const [friendRequestsError, setFriendRequestsError] = useState<ClientDataRequestError | null>(
    null,
  )
  const [friendRequestsLoading, setFriendRequestsLoading] = useState(false)
  const [me, setMe] = useState<ClientUser | null>(null)
  const [meError, setMeError] = useState<ClientDataRequestError | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [meRefreshing, setMeRefreshing] = useState(false)
  const [personalProject, setPersonalProject] = useState<ClientProjectSummary | null>(null)
  const [projects, setProjects] = useState<ClientProjectSummary[]>([])
  const [projectsError, setProjectsError] = useState<ClientDataRequestError | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsLoadingMore, setProjectsLoadingMore] = useState(false)
  const [projectsNextCursor, setProjectsNextCursor] = useState<string | null>(null)
  const [projectsRefreshing, setProjectsRefreshing] = useState(false)
  const conversationMessageStatesRef = useRef(conversationMessageStates)
  const conversationsRef = useRef(conversations)
  const mountedRef = useRef(true)
  const loadingConversationOperationsRef = useRef<Map<string, symbol>>(new Map())
  const conversationsNeedingServerRefreshRef = useRef<Set<string>>(new Set())
  const syncingAfterConversationOperationsRef = useRef<Map<string, symbol>>(new Map())
  const scheduleConversationGapSyncRef = useRef<
    (conversations: readonly ClientConversation[], listRefreshId?: string) => void
  >(() => undefined)
  const historyRequestVersionsRef = useRef<Map<string, number>>(new Map())
  const historyRequestControllersRef = useRef<Map<string, AbortController>>(new Map())
  const historyFocusRequestKeyRef = useRef(0)
  const refreshingReactionSnapshotKeysRef = useRef<Set<string>>(new Set())
  const reactionSnapshotMinimumVersionsRef = useRef<Map<string, number>>(new Map())
  const messageManagerRef = useRef<{ key: string; manager: MessageManager } | null>(null)
  const includedConversationIdRef = useRef(includedConversationId)
  const contactsRefreshEpochRef = useRef(0)
  const friendRequestsRefreshEpochRef = useRef(0)
  const contactDirectoryModeRef = useRef<ContactDirectoryMode>(contactDirectoryMode)
  const conversationRefreshEpochRef = useRef(0)
  const [userDirectory] = useState(
    () =>
      new ClientUserDirectory(
        (userIds, signal) => resolveClientUsers(userIds, undefined, signal),
        setUsersById,
      ),
  )
  const getUser = useCallback((userId: string) => userDirectory.getUser(userId), [userDirectory])
  const ensureUsers = useCallback(
    (userIds: readonly string[]) => userDirectory.ensureUsers(userIds),
    [userDirectory],
  )
  const invalidateUsers = useCallback(
    (userIds: readonly string[], updatedAt?: string) =>
      userDirectory.invalidateUsers(userIds, updatedAt),
    [userDirectory],
  )
  const updateUserPresence = useCallback(
    (userId: string, online: boolean, lastOnlineAt?: string | null) =>
      userDirectory.updateUserPresence(userId, online, lastOnlineAt),
    [userDirectory],
  )

  useEffect(() => {
    contactDirectoryModeRef.current = contactDirectoryMode
  }, [contactDirectoryMode])
  const visibleContactGroups = useMemo(
    () => hydrateContactGroupUsers(contactGroups, contactApps, usersById),
    [contactApps, contactGroups, usersById],
  )
  const visibleConversations = useMemo(() => {
    const appsById = Object.fromEntries(contactApps.map((app) => [app.id, app]))
    return conversations.map((conversation) =>
      hydrateConversationUsers(conversation, usersById, appsById),
    )
  }, [contactApps, conversations, usersById])
  const contacts = useMemo(
    () => contactUserIds.map((userId) => usersById[userId] ?? createContactPlaceholder(userId)),
    [contactUserIds, usersById],
  )
  const { applyConversationMessageRetention, registerConversationMessageView } =
    useConversationMessageRetention()
  const cacheTarget = getMessageCacheTarget()
  const cacheTargetKey = cacheTarget ? messageCacheTargetKey(cacheTarget) : ""
  const diagnosticTargetScope = cacheTarget?.id
  if (
    cacheTarget &&
    cacheTarget.userId !== "anonymous" &&
    messageManagerRef.current?.key !== cacheTargetKey
  ) {
    messageManagerRef.current = {
      key: cacheTargetKey,
      manager: new MessageManager(new DesktopMessageRepository(cacheTarget)),
    }
  }
  const messageManager = messageManagerRef.current?.manager ?? null

  useEffect(() => {
    if (!cacheTarget || !messageManager) return
    return registerMessageCacheClearHandler(cacheTarget, async () => {
      await messageManager.clearPersistentCache()
      const conversationsNeedingServerRefresh = conversationsNeedingServerRefreshRef.current
      conversationsNeedingServerRefresh.clear()
      for (const [conversationId, state] of Object.entries(conversationMessageStatesRef.current)) {
        if (state.loaded) conversationsNeedingServerRefresh.add(conversationId)
      }
    })
  }, [cacheTarget, messageManager])

  useEffect(() => {
    conversationsNeedingServerRefreshRef.current.clear()
  }, [cacheTargetKey])

  useEffect(() => {
    conversationMessageStatesRef.current = conversationMessageStates
  }, [conversationMessageStates])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const directoryUserIds = useMemo(
    () => [
      ...new Set([
        ...collectContactGroupUserIds(contactGroups),
        ...collectConversationUserIds(conversations),
        ...collectConversationMessageUserIds(conversationMessageStates),
      ]),
    ],
    [contactGroups, conversationMessageStates, conversations],
  )

  useEffect(() => {
    if (directoryUserIds.length > 0) {
      void userDirectory.ensureUsers(directoryUserIds).catch(() => undefined)
    }
  }, [directoryUserIds, userDirectory])

  useLayoutEffect(() => {
    if (includedConversationIdRef.current !== includedConversationId) {
      conversationRefreshEpochRef.current += 1
    }
    includedConversationIdRef.current = includedConversationId
  }, [includedConversationId])

  const markConversationsMutated = useCallback(() => {
    conversationRefreshEpochRef.current += 1
  }, [])

  useEffect(() => {
    const loadedStates = Object.values(conversationMessageStates)
    updateDiagnosticData({
      contacts: contacts.length,
      conversations: conversations.length,
      loadedConversations: loadedStates.length,
      messages: loadedStates.reduce((total, state) => total + state.messages.length, 0),
      projects: projects.length,
    })
  }, [contacts.length, conversationMessageStates, conversations.length, projects.length])

  useEffect(() => {
    mountedRef.current = true
    const historyRequestControllers = historyRequestControllersRef.current

    return () => {
      mountedRef.current = false
      contactsRefreshEpochRef.current += 1
      friendRequestsRefreshEpochRef.current += 1
      for (const controller of historyRequestControllers.values()) controller.abort()
      historyRequestControllers.clear()
      userDirectory?.clear()
      updateDiagnosticData({
        contacts: 0,
        conversations: 0,
        loadedConversations: 0,
        messages: 0,
        projects: 0,
      })
    }
  }, [userDirectory])

  const handleError = useCallback(
    (error: unknown, fallbackMessage: string) => {
      const requestError =
        error instanceof ClientDataRequestError
          ? error
          : new ClientDataRequestError(fallbackMessage)

      if (requestError.status === 401 || requestError.code === "unauthorized") {
        if (!mountedRef.current) {
          return requestError
        }

        contactsRefreshEpochRef.current += 1
        friendRequestsRefreshEpochRef.current += 1
        setAuthenticated(false)
        void messageManager?.clear().catch(() => undefined)
        setConversations([])
        setConversationMessageStates({})
        setContactApps([])
        contactDirectoryModeRef.current = "organization"
        setContactDirectoryMode("organization")
        setContactGroups([])
        setContactUserIds([])
        setUsersById({})
        setIncomingFriendRequests([])
        setOutgoingFriendRequests([])
        userDirectory?.clear()
        setPersonalProject(null)
        setProjects([])
        setMe(null)
        navigate("/login", { replace: true })
      }

      return requestError
    },
    [messageManager, navigate, setAuthenticated, userDirectory],
  )

  const refreshMe = useCallback(
    () =>
      trackDiagnosticRefresh("me", async () => {
        const isInitialLoad = me === null
        setMeError(null)
        setMeLoading(isInitialLoad)
        setMeRefreshing(!isInitialLoad)

        try {
          setMe(await getCurrentClientUser())
        } catch (error) {
          const requestError = handleError(error, "加载当前用户失败")
          setMeError(requestError)
          throw requestError
        } finally {
          setMeLoading(false)
          setMeRefreshing(false)
        }
      }),
    [handleError, me],
  )

  const refreshFriendRequests = useCallback(
    async (directoryMode = contactDirectoryModeRef.current) => {
      const requestEpoch = ++friendRequestsRefreshEpochRef.current
      if (directoryMode !== "friends") {
        if (mountedRef.current && friendRequestsRefreshEpochRef.current === requestEpoch) {
          setFriendRequestsError(null)
          setFriendRequestsLoading(false)
          setIncomingFriendRequests([])
          setOutgoingFriendRequests([])
        }
        return
      }
      setFriendRequestsLoading(true)
      setFriendRequestsError(null)
      try {
        const [incoming, outgoing] = await Promise.all([
          listFriendRequests("incoming"),
          listFriendRequests("outgoing"),
        ])
        if (!mountedRef.current || friendRequestsRefreshEpochRef.current !== requestEpoch) return
        setIncomingFriendRequests(incoming)
        setOutgoingFriendRequests(outgoing)
        void userDirectory
          .ensureUsers([
            ...incoming.map((request) => request.requesterUserId),
            ...outgoing.map((request) => request.addresseeUserId),
          ])
          .catch(() => undefined)
      } catch (error) {
        const requestError = handleError(error, "加载好友申请失败")
        if (mountedRef.current && friendRequestsRefreshEpochRef.current === requestEpoch) {
          setFriendRequestsError(requestError)
        }
        throw requestError
      } finally {
        if (mountedRef.current && friendRequestsRefreshEpochRef.current === requestEpoch) {
          setFriendRequestsLoading(false)
        }
      }
    },
    [handleError, userDirectory],
  )

  const refreshContacts = useCallback(
    async (): Promise<ContactDirectoryMode> =>
      trackDiagnosticRefresh("contacts", async () => {
        const requestEpoch = ++contactsRefreshEpochRef.current
        const isInitialLoad =
          contacts.length === 0 && contactApps.length === 0 && contactGroups.length === 0
        setContactsError(null)
        setContactsLoading(isInitialLoad)
        setContactsRefreshing(!isInitialLoad)

        try {
          const nextContacts = await listClientContacts()
          if (!mountedRef.current || contactsRefreshEpochRef.current !== requestEpoch) {
            return contactDirectoryModeRef.current
          }
          const previousDirectoryMode = contactDirectoryModeRef.current
          setContactApps(nextContacts.apps)
          contactDirectoryModeRef.current = nextContacts.directoryMode
          setContactDirectoryMode(nextContacts.directoryMode)
          setContactGroups(nextContacts.groups)
          userDirectory.seed(nextContacts.initialUsers)
          setContactUserIds(nextContacts.userIds)
          void userDirectory.ensureUsers(nextContacts.userIds).catch(() => undefined)
          if (nextContacts.directoryMode !== "friends") {
            friendRequestsRefreshEpochRef.current += 1
            setFriendRequestsError(null)
            setFriendRequestsLoading(false)
            setIncomingFriendRequests([])
            setOutgoingFriendRequests([])
          } else if (previousDirectoryMode !== "friends") {
            await refreshFriendRequests(nextContacts.directoryMode)
          }
          return nextContacts.directoryMode
        } catch (error) {
          const requestError = handleError(error, "加载通讯录失败")
          if (contactsRefreshEpochRef.current === requestEpoch) setContactsError(requestError)
          throw requestError
        } finally {
          if (contactsRefreshEpochRef.current === requestEpoch) {
            setContactsLoading(false)
            setContactsRefreshing(false)
          }
        }
      }),
    [
      contactApps.length,
      contactGroups.length,
      contacts.length,
      handleError,
      refreshFriendRequests,
      userDirectory,
    ],
  )

  const refreshFriendData = useCallback(
    async ({ includeContacts = true }: { includeContacts?: boolean } = {}) => {
      const directoryMode = includeContacts
        ? await refreshContacts()
        : contactDirectoryModeRef.current
      await refreshFriendRequests(directoryMode)
    },
    [refreshContacts, refreshFriendRequests],
  )

  const reconcileFailedFriendMutation = useCallback(
    async () => refreshFriendData().catch(() => undefined),
    [refreshFriendData],
  )

  const createFriendRequest = useCallback(
    async (userId: string) => {
      try {
        await createFriendRequestRequest(userId)
      } catch (error) {
        const requestError = handleError(error, "发送好友申请失败")
        await reconcileFailedFriendMutation()
        throw requestError
      }

      await refreshFriendData()
    },
    [handleError, reconcileFailedFriendMutation, refreshFriendData],
  )

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await acceptFriendRequestRequest(requestId)
      } catch (error) {
        const requestError = handleError(error, "接受好友申请失败")
        await reconcileFailedFriendMutation()
        throw requestError
      }

      await refreshFriendData()
    },
    [handleError, reconcileFailedFriendMutation, refreshFriendData],
  )

  const rejectFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await rejectFriendRequestRequest(requestId)
      } catch (error) {
        const requestError = handleError(error, "拒绝好友申请失败")
        await reconcileFailedFriendMutation()
        throw requestError
      }

      await refreshFriendData()
    },
    [handleError, reconcileFailedFriendMutation, refreshFriendData],
  )

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await cancelFriendRequestRequest(requestId)
      } catch (error) {
        const requestError = handleError(error, "取消好友申请失败")
        await reconcileFailedFriendMutation()
        throw requestError
      }

      await refreshFriendData()
    },
    [handleError, reconcileFailedFriendMutation, refreshFriendData],
  )

  const deleteFriend = useCallback(
    async (userId: string) => {
      try {
        await deleteFriendRequest(userId)
      } catch (error) {
        const requestError = handleError(error, "删除好友失败")
        await reconcileFailedFriendMutation()
        throw requestError
      }

      await refreshFriendData()
    },
    [handleError, reconcileFailedFriendMutation, refreshFriendData],
  )

  const refreshConversations = useCallback(
    () =>
      trackDiagnosticRefresh("conversations", async () => {
        const requestEpoch = ++conversationRefreshEpochRef.current
        const listRefreshId = createDiagnosticId()
        const startedAt = performance.now()
        const context = {
          ...(diagnosticTargetScope ? { targetScope: diagnosticTargetScope } : {}),
          listRefreshId,
        }
        try {
          const nextConversations = await listClientConversations(undefined, {
            includeConversationId: includedConversationIdRef.current,
          })
          if (conversationRefreshEpochRef.current !== requestEpoch) return
          setConversations(orderConversations(nextConversations))
          void userDirectory
            .ensureUsers(collectConversationUserIds(nextConversations))
            .catch(() => undefined)
          void recordRendererDiagnostic("conversation-list.completed", context, {
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            endpoint: "conversation-list",
            responseStatus: 200,
            returnedCount: nextConversations.length,
          })
          scheduleConversationGapSyncRef.current(nextConversations, listRefreshId)
        } catch (error) {
          if (conversationRefreshEpochRef.current !== requestEpoch) return
          void recordRendererDiagnostic("conversation-list.failed", context, {
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            endpoint: "conversation-list",
            error: { category: classifyDiagnosticError(error), phase: "list" },
          })
          throw handleError(error, "加载会话列表失败")
        }
      }),
    [diagnosticTargetScope, handleError, userDirectory],
  )

  const refreshProjects = useCallback(
    () =>
      trackDiagnosticRefresh("projects", async () => {
        const isInitialLoad = personalProject === null && projects.length === 0
        setProjectsError(null)
        setProjectsLoading(isInitialLoad)
        setProjectsRefreshing(!isInitialLoad)

        try {
          const page = await listClientProjects({ limit: 100 })
          setPersonalProject(page.personalProject)
          setProjects(page.projects)
          setProjectsNextCursor(page.nextCursor)
        } catch (error) {
          const requestError = handleError(error, "加载项目列表失败")
          setProjectsError(requestError)
          throw requestError
        } finally {
          setProjectsLoading(false)
          setProjectsRefreshing(false)
        }
      }),
    [handleError, personalProject, projects.length],
  )

  const loadMoreProjects = useCallback(async () => {
    if (!projectsNextCursor || projectsLoadingMore) {
      return
    }

    setProjectsLoadingMore(true)
    try {
      const page = await listClientProjects({
        cursor: projectsNextCursor,
        limit: 100,
      })
      setPersonalProject(page.personalProject)
      setProjects((currentProjects) => {
        const projectById = new Map(currentProjects.map((project) => [project.id, project]))

        for (const project of page.projects) {
          projectById.set(project.id, project)
        }

        return Array.from(projectById.values())
      })
      setProjectsNextCursor(page.nextCursor)
    } catch (error) {
      throw handleError(error, "加载更多项目失败")
    } finally {
      setProjectsLoadingMore(false)
    }
  }, [handleError, projectsLoadingMore, projectsNextCursor])

  const createProject = useCallback(
    async (name: string, groupIds: string[] = []) => {
      let project: ClientProjectDetail

      try {
        project = await createClientProjectRequest({ groupIds, name })
      } catch (error) {
        throw handleError(error, "创建项目失败")
      }

      try {
        await refreshProjects()
      } catch {
        throw new ClientDataRequestError("项目已创建，但刷新项目列表失败")
      }

      return project
    },
    [handleError, refreshProjects],
  )

  const updateConversationMessageState = useCallback(
    (
      conversationId: string,
      updater: (state: ClientConversationMessageState) => ClientConversationMessageState,
    ) => {
      setConversationMessageStates((currentStates) => {
        const previousState = currentStates[conversationId] ?? createConversationMessageState()
        const nextState = applyConversationMessageRetention(conversationId, updater(previousState))

        return {
          ...currentStates,
          [conversationId]: nextState,
        }
      })
    },
    [applyConversationMessageRetention],
  )

  useEffect(() => {
    if (!messageManager) return
    return messageManager.subscribe((event) => {
      if (event.kind === "scope-cleared") {
        conversationsNeedingServerRefreshRef.current.clear()
        setConversationMessageStates({})
        return
      }
      if (event.kind === "conversation-cleared") {
        conversationsNeedingServerRefreshRef.current.delete(event.conversationId)
        setConversationMessageStates((currentStates) => {
          if (!(event.conversationId in currentStates)) return currentStates
          const nextStates = { ...currentStates }
          delete nextStates[event.conversationId]
          return nextStates
        })
        return
      }
      if (event.kind === "sync-error") {
        updateConversationMessageState(event.conversationId, (state) => ({
          ...state,
          error: state.error ?? "本地消息缓存暂时不可用，已切换为内存模式",
        }))
        return
      }
      if (event.kind === "history-window-changed") {
        updateConversationMessageState(event.conversationId, (state) => {
          if (
            state.viewMode !== "history" ||
            !state.historyTarget ||
            event.snapshot.target?.messageId !== state.historyTarget.messageId
          ) {
            return state
          }
          const messages = [...event.snapshot.messages]
          return {
            ...state,
            error: null,
            messages,
            page: {
              hasMoreAfter: event.snapshot.hasMoreAfter,
              hasMoreBefore: event.snapshot.hasMoreBefore,
              limit: messagePageLimit,
              newestSeq: event.snapshot.newestSeq,
              oldestSeq: event.snapshot.oldestSeq,
            },
          }
        })
        return
      }
      updateConversationMessageState(event.conversationId, (state) => {
        const latestKnownSeq = Math.max(state.latestKnownSeq, event.messages.at(-1)?.seq ?? 0)
        if (state.viewMode === "history") {
          return { ...state, latestKnownSeq }
        }
        return {
          ...state,
          error: null,
          latestKnownSeq,
          messages: event.messages,
          page: updatePageWithMessage(state.page, event.messages),
        }
      })
    })
  }, [messageManager, updateConversationMessageState])

  const compactConversationMessages = useCallback(
    (conversationId: string) => {
      if (!conversationId) return
      messageManager?.compact(conversationId, 300)
      setConversationMessageStates((currentStates) => {
        const currentState = currentStates[conversationId]
        if (!currentState) return currentStates
        const nextState = compactConversationMessageState(currentState)
        return nextState === currentState
          ? currentStates
          : { ...currentStates, [conversationId]: nextState }
      })
    },
    [messageManager],
  )

  const clearMessageScope = useCallback(() => {
    void messageManager?.clear().catch(() => undefined)
  }, [messageManager])

  const applyConversationMessageToList = useCallback(
    (message: ClientMessage, options: { countUnread?: boolean } = {}) => {
      const conversationExists = conversationsRef.current.some(
        (conversation) => conversation.id === message.conversationId,
      )

      setConversations((currentConversations) => {
        const conversation = currentConversations.find(
          (currentConversation) => currentConversation.id === message.conversationId,
        )

        if (!conversation) {
          return currentConversations
        }

        if (message.seq < conversation.lastMessageSeq) {
          return currentConversations
        }

        const shouldIncrementUnread =
          Boolean(options.countUnread) &&
          message.seq > conversation.lastMessageSeq &&
          message.seq > conversation.lastReadSeq
        const updatedConversation: ClientConversation = {
          ...conversation,
          lastMessageAt: message.createdAt,
          lastMessageId: message.id,
          lastMessageSeq: message.seq,
          lastMessageSender: getConversationLastMessageSender(conversation, message),
          lastMessageSummary: getMessageSummary(message),
          unreadCount: shouldIncrementUnread
            ? conversation.unreadCount + 1
            : conversation.unreadCount,
        }

        return orderConversations([
          updatedConversation,
          ...currentConversations.filter(
            (currentConversation) => currentConversation.id !== message.conversationId,
          ),
        ])
      })

      if (!conversationExists) {
        void refreshConversations().catch(() => undefined)
      }
    },
    [refreshConversations],
  )

  const updateConversationLastMessage = useCallback(
    (message: ClientMessage) => {
      applyConversationMessageToList(message)
    },
    [applyConversationMessageToList],
  )

  const rememberConversationMessage = useCallback(
    (message: ClientMessage) => {
      applyConversationMessageToList(message)
    },
    [applyConversationMessageToList],
  )

  const updateTopicSourcePreview = useCallback((message: ClientMessage) => {
    const topicConversation = conversationsRef.current.find(
      (conversation) => conversation.id === message.conversationId && conversation.type === "topic",
    )
    const topic = topicConversation?.topic
    if (!topic || message.sender.type === "system") {
      return
    }

    setConversationMessageStates((currentStates) => {
      const parentState = currentStates[topic.parentConversationId]
      if (!parentState) {
        return currentStates
      }
      let changed = false
      const messages = parentState.messages.map((sourceMessage) => {
        if (sourceMessage.id !== topic.sourceMessageId || !sourceMessage.topic) {
          return sourceMessage
        }
        const existingReplies = (sourceMessage.topic.recentReplies ?? []).filter(
          (reply) => reply.id !== message.id,
        )
        const recentReplies =
          message.body.type === "revoked"
            ? existingReplies
            : [
                ...existingReplies,
                {
                  createdAt: message.createdAt,
                  id: message.id,
                  sender: message.sender,
                  summary: getMessageSummary(message),
                },
              ].slice(-3)
        changed = true
        return {
          ...sourceMessage,
          topic: { ...sourceMessage.topic, recentReplies },
        }
      })
      return changed
        ? {
            ...currentStates,
            [topic.parentConversationId]: { ...parentState, messages },
          }
        : currentStates
    })
  }, [])

  const mergeIncomingConversationMessage = useCallback(
    (message: ClientMessage, options: { markLoaded?: boolean; updateList?: boolean } = {}) => {
      if (messageManager) {
        void messageManager.ingest("local", [message]).catch(() => undefined)
        if (options.markLoaded) {
          updateConversationMessageState(message.conversationId, (state) => ({
            ...state,
            loaded: true,
          }))
        }
      } else {
        updateConversationMessageState(message.conversationId, (state) => {
          const messages = mergeConversationMessages(state.messages, [message])
          return {
            ...state,
            error: null,
            loaded: options.markLoaded ? true : state.loaded,
            messages,
            page: updatePageWithMessage(state.page, messages),
          }
        })
      }
      updateTopicSourcePreview(message)
      if (options.updateList !== false) {
        rememberConversationMessage(message)
      }
    },
    [
      messageManager,
      rememberConversationMessage,
      updateConversationMessageState,
      updateTopicSourcePreview,
    ],
  )

  const currentUserId = me?.id ?? ""
  const refreshMessageReactions = useCallback(
    async (conversationId: string, rawMessageIds: string[]) => {
      const messageIds = [...new Set(rawMessageIds)].filter((messageId) => {
        const key = `${conversationId}:${messageId}`
        return !refreshingReactionSnapshotKeysRef.current.has(key)
      })
      const batches: string[][] = []
      for (let index = 0; index < messageIds.length; index += reactionSnapshotBatchSize) {
        batches.push(messageIds.slice(index, index + reactionSnapshotBatchSize))
      }

      await Promise.all(
        batches.map(async (initialBatch) => {
          let batch = initialBatch
          let attempts = 0
          while (batch.length > 0 && attempts < maxReactionSnapshotCatchUpAttempts) {
            attempts += 1
            for (const messageId of batch) {
              refreshingReactionSnapshotKeysRef.current.add(`${conversationId}:${messageId}`)
            }
            let snapshots: MessageReactionSnapshot[]
            try {
              snapshots = await listConversationMessageReactionSnapshots(conversationId, batch)
              if (messageManager) {
                await Promise.all(
                  snapshots.map((snapshot) => messageManager.applyReactionSnapshot(snapshot)),
                )
              } else {
                setConversationMessageStates((currentStates) => {
                  const state = currentStates[conversationId]
                  if (!state) return currentStates
                  const snapshotsByMessageId = new Map(
                    snapshots.map((snapshot) => [snapshot.messageId, snapshot]),
                  )
                  let changed = false
                  const messages = state.messages.map((message) => {
                    const snapshot = snapshotsByMessageId.get(message.id)
                    if (!snapshot) return message
                    const nextMessage = applyMessageReactionSnapshot(message, snapshot)
                    if (nextMessage !== message) changed = true
                    return nextMessage
                  })
                  return changed
                    ? {
                        ...currentStates,
                        [conversationId]: { ...state, messages },
                      }
                    : currentStates
                })
              }
            } catch (error) {
              for (const messageId of batch) {
                reactionSnapshotMinimumVersionsRef.current.delete(`${conversationId}:${messageId}`)
              }
              throw error
            } finally {
              for (const messageId of batch) {
                refreshingReactionSnapshotKeysRef.current.delete(`${conversationId}:${messageId}`)
              }
            }

            const versionsByMessageId = new Map(
              snapshots.map((snapshot) => [snapshot.messageId, snapshot.reactionVersion]),
            )
            batch = batch.filter((messageId) => {
              const key = `${conversationId}:${messageId}`
              const minimumVersion = reactionSnapshotMinimumVersionsRef.current.get(key) ?? 0
              if ((versionsByMessageId.get(messageId) ?? -1) < minimumVersion) {
                return true
              }
              reactionSnapshotMinimumVersionsRef.current.delete(key)
              return false
            })
          }
          for (const messageId of batch) {
            reactionSnapshotMinimumVersionsRef.current.delete(`${conversationId}:${messageId}`)
          }
        }),
      )
    },
    [messageManager],
  )

  const handleIncomingConversationMessage = useCallback(
    (
      message: ClientMessage,
      options: { activeConversationId?: string; visible?: boolean } = {},
    ) => {
      const fromCurrentUser =
        currentUserId !== "" && isClientMessageInitiatedByUser(message, currentUserId)
      const messageState = conversationMessageStatesRef.current[message.conversationId]
      const activeConversation = options.activeConversationId === message.conversationId
      const visibleInActiveConversation =
        Boolean(options.visible) && activeConversation && messageState?.viewMode !== "history"
      const shouldCacheMessage = activeConversation || messageState?.loaded || messageState?.loading

      if (shouldCacheMessage) {
        mergeIncomingConversationMessage(message, { updateList: false })
      } else {
        updateTopicSourcePreview(message)
        void messageManager?.persist([message])
      }
      if (
        messageState?.viewMode === "history" &&
        message.seq > (messageState.page?.newestSeq ?? 0)
      ) {
        updateConversationMessageState(message.conversationId, (state) => ({
          ...state,
          latestKnownSeq: Math.max(state.latestKnownSeq, message.seq),
          pendingLatestMessageCount: state.pendingLatestMessageCount + 1,
        }))
      }
      applyConversationMessageToList(message, {
        countUnread: !fromCurrentUser && !visibleInActiveConversation,
      })
    },
    [
      applyConversationMessageToList,
      currentUserId,
      messageManager,
      mergeIncomingConversationMessage,
      updateConversationMessageState,
      updateTopicSourcePreview,
    ],
  )

  const handleIncomingConversationMessageUpdate = useCallback(
    (message: ClientMessage) => {
      if (messageManager) {
        const state = conversationMessageStatesRef.current[message.conversationId]
        if (state?.messages.some((existing) => existing.id === message.id))
          void messageManager.ingest("realtime", [message]).catch(() => undefined)
        else void messageManager.persist([message])
      } else {
        setConversationMessageStates((currentStates) => {
          const state = currentStates[message.conversationId]
          if (!state?.messages.some((existing) => existing.id === message.id)) {
            return currentStates
          }
          const messages = mergeConversationMessages(state.messages, [message])
          return {
            ...currentStates,
            [message.conversationId]: {
              ...state,
              error: null,
              messages,
              page: updatePageWithMessage(state.page, messages),
            },
          }
        })
      }
      updateTopicSourcePreview(message)
    },
    [messageManager, updateTopicSourcePreview],
  )

  const handleIncomingMessageReactionsUpdate = useCallback(
    (event: MessageReactionsUpdatedEvent) => {
      const state = conversationMessageStatesRef.current[event.conversationId]
      const message = state?.messages.find((candidate) => candidate.id === event.messageId)
      if (!message) {
        void messageManager?.applyReaction(event, currentUserId).catch(() => undefined)
        return
      }
      if (message.reactionVersion >= event.reactionVersion) {
        return
      }
      if (event.reactionVersion > message.reactionVersion + 1) {
        const key = `${event.conversationId}:${event.messageId}`
        const previousMinimum = reactionSnapshotMinimumVersionsRef.current.get(key) ?? 0
        reactionSnapshotMinimumVersionsRef.current.set(
          key,
          Math.max(previousMinimum, event.reactionVersion),
        )
        void refreshMessageReactions(event.conversationId, [event.messageId]).catch(() => undefined)
        return
      }
      if (messageManager) {
        void messageManager.applyReaction(event, currentUserId).catch(() => undefined)
      } else {
        setConversationMessageStates((currentStates) => {
          const state = currentStates[event.conversationId]
          if (!state) {
            return currentStates
          }
          const messageIndex = state.messages.findIndex((message) => message.id === event.messageId)
          if (
            messageIndex < 0 ||
            (state.messages[messageIndex].reactionVersion ?? 0) >= event.reactionVersion
          ) {
            return currentStates
          }
          const messages = [...state.messages]
          messages[messageIndex] = applyMessageReactionsUpdate(
            messages[messageIndex],
            event,
            currentUserId,
          )
          return {
            ...currentStates,
            [event.conversationId]: { ...state, messages },
          }
        })
      }
    },
    [currentUserId, messageManager, refreshMessageReactions],
  )

  const applyChoiceSnapshots = useCallback(
    (
      snapshots: MessageChoiceSnapshot[],
      expectedChoices?: ReadonlyMap<string, ClientMessage["choice"]>,
    ) => {
      if (snapshots.length === 0) return
      const snapshotsByMessageId = new Map(
        snapshots.map((snapshot) => [snapshot.messageId, snapshot]),
      )
      if (!messageManager) {
        setConversationMessageStates((currentStates) => {
          let statesChanged = false
          const nextStates = { ...currentStates }
          for (const [conversationId, state] of Object.entries(currentStates)) {
            let messagesChanged = false
            const messages = state.messages
              .map((message) => {
                const snapshot = snapshotsByMessageId.get(message.id)
                if (!snapshot || snapshot.conversationId !== conversationId) return message
                const nextMessage = applyMessageChoiceSnapshot(
                  message,
                  snapshot,
                  expectedChoices?.has(message.id)
                    ? { expectedChoice: expectedChoices.get(message.id) }
                    : undefined,
                )
                if (nextMessage !== message) messagesChanged = true
                return nextMessage
              })
              .filter((message): message is ClientMessage => message !== null)
            if (messagesChanged) {
              statesChanged = true
              nextStates[conversationId] = { ...state, messages }
            }
          }
          return statesChanged ? nextStates : currentStates
        })
      }
      if (messageManager) {
        for (const snapshot of snapshots) {
          void messageManager
            .applyChoice(snapshot, expectedChoices?.get(snapshot.messageId))
            .catch(() => undefined)
        }
      }
    },
    [messageManager],
  )

  const handleIncomingMessageChoiceUpdate = useCallback(
    (event: MessageChoiceUpdatedEvent) => {
      if (messageManager) {
        void messageManager.applyChoiceUpdate(event, currentUserId).catch(() => undefined)
      } else {
        setConversationMessageStates((currentStates) => {
          const state = currentStates[event.conversationId]
          if (!state) return currentStates
          const messageIndex = state.messages.findIndex((message) => message.id === event.messageId)
          if (messageIndex < 0) return currentStates
          const previousMessage = state.messages[messageIndex]
          const nextMessage = applyMessageChoiceState(previousMessage, {
            ...event.choice,
            myOptionIds:
              event.actorUserId === currentUserId
                ? event.actorOptionIds
                : (previousMessage.choice?.myOptionIds ?? []),
          })
          if (nextMessage === previousMessage) return currentStates
          const messages = [...state.messages]
          messages[messageIndex] = nextMessage
          return { ...currentStates, [event.conversationId]: { ...state, messages } }
        })
      }
    },
    [currentUserId, messageManager],
  )

  const setMessageReaction = useCallback(
    async (conversationId: string, messageId: string, text: string, reacted: boolean) => {
      const result = await setConversationMessageReactionRequest(conversationId, messageId, {
        reacted,
        text,
      })
      if (messageManager) {
        await messageManager.applyReactionSnapshot(result)
      } else {
        setConversationMessageStates((currentStates) => {
          const state = currentStates[result.conversationId]
          if (!state) {
            return currentStates
          }
          const messageIndex = state.messages.findIndex(
            (message) => message.id === result.messageId,
          )
          if (messageIndex < 0) {
            return currentStates
          }
          const messages = [...state.messages]
          messages[messageIndex] = applyMessageReactionSnapshot(messages[messageIndex], result)
          if (messages[messageIndex] === state.messages[messageIndex]) {
            return currentStates
          }
          return {
            ...currentStates,
            [result.conversationId]: { ...state, messages },
          }
        })
      }
      return result
    },
    [messageManager],
  )

  const respondToChoice = useCallback(
    async (conversationId: string, messageId: string, optionIds: string[]) => {
      try {
        const result = await setConversationChoiceResponseRequest(
          conversationId,
          messageId,
          optionIds,
        )
        applyChoiceSnapshots([
          {
            choice: result.choice,
            conversationId: result.conversationId,
            messageId: result.messageId,
            status: "active",
          },
        ])
      } catch (error) {
        throw handleError(error, "提交选择失败")
      }
    },
    [applyChoiceSnapshots, handleError],
  )

  const updateConversationLastMentionedSeq = useCallback(
    (conversationId: string, lastMentionedSeq: number) => {
      if (!conversationId || lastMentionedSeq <= 0) {
        return
      }

      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastMentionedSeq: Math.max(conversation.lastMentionedSeq, lastMentionedSeq),
              }
            : conversation,
        ),
      )
    },
    [],
  )

  const updateConversationLastChoiceSeq = useCallback(
    (conversationId: string, lastChoiceSeq: number) => {
      if (!conversationId || lastChoiceSeq <= 0) return
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastChoiceSeq: Math.max(conversation.lastChoiceSeq, lastChoiceSeq),
              }
            : conversation,
        ),
      )
    },
    [],
  )

  const updateConversationPinned = useCallback((conversationId: string, pinned: boolean) => {
    if (!conversationId) {
      return
    }
    setConversations((currentConversations) =>
      orderConversations(
        currentConversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, pinned } : conversation,
        ),
      ),
    )
  }, [])

  const setConversationPinned = useCallback(
    async (conversationId: string, pinned: boolean) => {
      try {
        const result = await setConversationPinnedRequest(conversationId, pinned)
        updateConversationPinned(result.conversationId, result.pinned)
      } catch (error) {
        throw handleError(error, pinned ? "置顶会话失败" : "取消置顶失败")
      }
    },
    [handleError, updateConversationPinned],
  )

  const updateConversationMuted = useCallback((conversationId: string, muted: boolean) => {
    if (!conversationId) {
      return
    }
    setConversations((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, notificationMuted: muted }
          : conversation,
      ),
    )
  }, [])

  const setConversationMuted = useCallback(
    async (conversationId: string, muted: boolean) => {
      try {
        const result = await setConversationMutedRequest(conversationId, muted)
        updateConversationMuted(result.conversationId, result.muted)
      } catch (error) {
        throw handleError(error, muted ? "开启消息免打扰失败" : "取消消息免打扰失败")
      }
    },
    [handleError, updateConversationMuted],
  )

  const updateMessageTopic = useCallback(
    (
      parentConversationId: string,
      sourceMessageId: string,
      topic: Pick<ClientMessageTopic, "archived" | "conversationId">,
    ) => {
      setConversations((currentConversations) =>
        topic.archived
          ? currentConversations.filter((conversation) => conversation.id !== topic.conversationId)
          : currentConversations.map((conversation) =>
              conversation.id === topic.conversationId && conversation.topic
                ? {
                    ...conversation,
                    topic: { ...conversation.topic, archived: false },
                  }
                : conversation,
            ),
      )
      setConversationMessageStates((currentStates) => {
        const state = currentStates[parentConversationId]
        if (!state) {
          return currentStates
        }
        let changed = false
        const messages = state.messages.map((message) => {
          if (message.id !== sourceMessageId) {
            return message
          }
          changed = true
          return {
            ...message,
            topic: {
              ...message.topic,
              ...topic,
              recentReplies: message.topic?.recentReplies ?? [],
            },
          }
        })
        return changed
          ? {
              ...currentStates,
              [parentConversationId]: { ...state, messages },
            }
          : currentStates
      })
    },
    [],
  )

  const markConversationRead = useCallback(
    async (conversationId: string, options: MarkConversationReadOptions = {}) => {
      if (!conversationId) {
        return
      }

      try {
        const result = await markConversationReadRequest(conversationId, options)
        setConversations((currentConversations) =>
          currentConversations.map((conversation) =>
            conversation.id === result.conversationId
              ? {
                  ...conversation,
                  lastReadSeq: result.lastReadSeq,
                  unreadCount: result.unreadCount,
                }
              : conversation,
          ),
        )
      } catch (error) {
        throw handleError(error, "标记会话已读失败")
      }
    },
    [handleError],
  )

  const beginHistoryWindowRequest = useCallback((conversationId: string) => {
    historyRequestControllersRef.current.get(conversationId)?.abort()
    const controller = new AbortController()
    historyRequestControllersRef.current.set(conversationId, controller)
    const version = (historyRequestVersionsRef.current.get(conversationId) ?? 0) + 1
    historyRequestVersionsRef.current.set(conversationId, version)
    return { controller, version }
  }, [])

  const historyRequestIsCurrent = useCallback(
    (conversationId: string, version: number) =>
      historyRequestVersionsRef.current.get(conversationId) === version &&
      !historyRequestControllersRef.current.get(conversationId)?.signal.aborted,
    [],
  )

  const replaceWithLatestMessages = useCallback(
    (conversationId: string) => {
      if (!conversationId) return
      const { controller, version } = beginHistoryWindowRequest(conversationId)
      void messageManager?.clearHistoryWindow(conversationId).catch(() => undefined)
      updateConversationMessageState(conversationId, (state) => ({
        ...state,
        error: null,
        focus: null,
        historyTarget: null,
        loaded: false,
        loading: true,
        loadingAfter: false,
        loadingBefore: false,
        messages: messageManager?.getMessages(conversationId) ?? [],
        page: null,
        pendingLatestMessageCount: 0,
        viewMode: "latest",
      }))
      void recordRendererDiagnostic(
        "conversation-ui.view-changed",
        {
          ...(diagnosticTargetScope ? { targetScope: diagnosticTargetScope } : {}),
          conversationId,
        },
        { viewMode: "latest" },
      )

      void (async () => {
        try {
          const result = await listConversationMessages(conversationId, {
            limit: messagePageLimit,
            signal: controller.signal,
          })
          if (!historyRequestIsCurrent(conversationId, version)) return
          const operation = messageManager?.beginConversationOperation(conversationId)
          const messages = messageManager
            ? await messageManager.commitLatest(operation!, result.messages, result.page)
            : result.messages
          if (!historyRequestIsCurrent(conversationId, version)) return
          updateConversationMessageState(conversationId, (state) => ({
            ...state,
            error: null,
            loaded: true,
            loading: false,
            latestKnownSeq: Math.max(state.latestKnownSeq, result.page.newestSeq),
            messages,
            page: {
              ...result.page,
              newestSeq: messages.at(-1)?.seq ?? result.page.newestSeq,
              oldestSeq: messages[0]?.seq ?? result.page.oldestSeq,
            },
          }))
        } catch (error) {
          if (!historyRequestIsCurrent(conversationId, version)) return
          updateConversationMessageState(conversationId, (state) => ({
            ...state,
            error: getClientDataErrorMessage(error, "加载最新消息失败"),
            loading: false,
          }))
        }
      })()
    },
    [
      beginHistoryWindowRequest,
      diagnosticTargetScope,
      historyRequestIsCurrent,
      messageManager,
      updateConversationMessageState,
    ],
  )

  const focusConversationMessage = useCallback(
    async (conversationId: string, target: { messageId: string; seq: number }) => {
      if (!conversationId || !target.messageId || target.seq < 1) return
      const { controller, version } = beginHistoryWindowRequest(conversationId)
      const requestKey = ++historyFocusRequestKeyRef.current
      const guard = () =>
        historyRequestIsCurrent(conversationId, version) &&
        conversationMessageStatesRef.current[conversationId]?.historyTarget?.messageId ===
          target.messageId
      updateConversationMessageState(conversationId, (state) => ({
        ...state,
        error: null,
        focus: { messageId: target.messageId, requestKey },
        historyTarget: target,
        latestKnownSeq: Math.max(state.latestKnownSeq, target.seq),
        loaded: false,
        loading: true,
        loadingAfter: false,
        loadingBefore: false,
        messages: [],
        page: null,
        pendingLatestMessageCount: 0,
        viewMode: "history",
      }))
      void recordRendererDiagnostic(
        "conversation-ui.view-changed",
        {
          ...(diagnosticTargetScope ? { targetScope: diagnosticTargetScope } : {}),
          conversationId,
        },
        { viewMode: "history" },
      )

      try {
        const operation = messageManager?.beginConversationOperation(conversationId)
        if (messageManager && operation) {
          const cached = await messageManager.hydrateHistoryAround(
            operation,
            target,
            messagePageLimit * 2,
            guard,
          )
          if (cached && guard()) {
            updateConversationMessageState(conversationId, (state) => ({
              ...state,
              loaded: true,
              loading: true,
              messages: [...cached.messages],
              page: {
                hasMoreAfter: cached.hasMoreAfter,
                hasMoreBefore: cached.hasMoreBefore,
                limit: messagePageLimit,
                newestSeq: cached.newestSeq,
                oldestSeq: cached.oldestSeq,
              },
            }))
          }
        }
        const [before, after] = await Promise.all([
          listConversationMessages(conversationId, {
            beforeSeq: target.seq + 1,
            limit: messagePageLimit,
            signal: controller.signal,
          }),
          listConversationMessages(conversationId, {
            afterSeq: target.seq,
            limit: messagePageLimit,
            signal: controller.signal,
          }),
        ])
        if (!historyRequestIsCurrent(conversationId, version)) return
        const messages = mergeConversationMessages(before.messages, after.messages)
        if (!messages.some((message) => message.id === target.messageId)) {
          throw new Error("目标消息已删除或不可见")
        }
        if (messageManager) {
          await messageManager.replaceHistoryWindow(
            operation!,
            target,
            messages,
            {
              hasMoreAfter: after.page.hasMoreAfter,
              hasMoreBefore: before.page.hasMoreBefore,
            },
            guard,
          )
        }
        if (!historyRequestIsCurrent(conversationId, version)) return
        updateConversationMessageState(conversationId, (state) => ({
          ...state,
          error: null,
          loaded: true,
          loading: false,
          latestKnownSeq: Math.max(state.latestKnownSeq, after.page.newestSeq),
          messages: messageManager
            ? [...messageManager.getHistoryWindow(conversationId).messages]
            : messages,
          page: messageManager
            ? {
                hasMoreAfter: messageManager.getHistoryWindow(conversationId).hasMoreAfter,
                hasMoreBefore: messageManager.getHistoryWindow(conversationId).hasMoreBefore,
                limit: messagePageLimit,
                newestSeq: messageManager.getHistoryWindow(conversationId).newestSeq,
                oldestSeq: messageManager.getHistoryWindow(conversationId).oldestSeq,
              }
            : {
                hasMoreAfter: after.page.hasMoreAfter,
                hasMoreBefore: before.page.hasMoreBefore,
                limit: messagePageLimit,
                newestSeq: messages.at(-1)?.seq ?? 0,
                oldestSeq: messages[0]?.seq ?? 0,
              },
        }))
      } catch (error) {
        if (!historyRequestIsCurrent(conversationId, version)) return
        const message = getClientDataErrorMessage(error, "定位消息失败")
        updateConversationMessageState(conversationId, (state) => ({
          ...state,
          error: message,
          loaded: false,
          loading: false,
        }))
        toast.error(message)
        replaceWithLatestMessages(conversationId)
      }
    },
    [
      beginHistoryWindowRequest,
      diagnosticTargetScope,
      historyRequestIsCurrent,
      messageManager,
      replaceWithLatestMessages,
      updateConversationMessageState,
    ],
  )

  const consumeConversationMessageFocus = useCallback(
    (conversationId: string, consumedFocus: { messageId: string; requestKey: number }) => {
      updateConversationMessageState(conversationId, (state) =>
        consumeMessageFocusState(state, consumedFocus),
      )
    },
    [updateConversationMessageState],
  )

  const ensureConversationMessages = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        return
      }

      const state = conversationMessageStatesRef.current[conversationId]
      const needsServerRefresh = conversationsNeedingServerRefreshRef.current.has(conversationId)
      if (
        (state?.loaded && !needsServerRefresh) ||
        state?.loading ||
        loadingConversationOperationsRef.current.has(conversationId)
      ) {
        return
      }
      const wasLoaded = state?.loaded === true

      let operation: MessageOperationToken | undefined
      try {
        operation = messageManager?.beginConversationOperation(conversationId)
      } catch (error) {
        if (isMessageOperationCancelled(error)) return
        throw error
      }

      const loadingOperation = Symbol(conversationId)
      loadingConversationOperationsRef.current.set(conversationId, loadingOperation)
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        loading: true,
      }))

      void (async () => {
        let restoredFromCache = false
        let cacheReadFailed = false
        try {
          if (messageManager) {
            try {
              const cached = await messageManager.hydrateRecent(operation!, messagePageLimit)
              if (cached.length > 0) {
                restoredFromCache = true
                updateConversationMessageState(conversationId, (currentState) => ({
                  ...currentState,
                  error: null,
                  loaded: true,
                  loading: true,
                  messages: cached,
                  page: updatePageWithMessage(currentState.page, cached),
                }))
              }
            } catch (error) {
              if (isMessageOperationCancelled(error)) throw error
              cacheReadFailed = true
            }
          }

          const result = await listConversationMessages(conversationId, {
            limit: messagePageLimit,
          })
          const messages = messageManager
            ? await messageManager.commitLatest(operation!, result.messages, result.page)
            : mergeConversationMessages(
                conversationMessageStatesRef.current[conversationId]?.messages ?? [],
                result.messages,
              )
          if (operation) messageManager?.assertOperationCurrent(operation)
          conversationsNeedingServerRefreshRef.current.delete(conversationId)
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: cacheReadFailed ? messageCacheFallbackNotice : null,
            loaded: true,
            loading: false,
            messages,
            page: {
              ...result.page,
              newestSeq: messages.at(-1)?.seq ?? result.page.newestSeq,
              oldestSeq: messages[0]?.seq ?? result.page.oldestSeq,
            },
          }))
        } catch (error) {
          if (isMessageOperationCancelled(error)) return
          const message = getClientDataErrorMessage(error, "加载消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loaded: wasLoaded || restoredFromCache,
            loading: false,
          }))
          if (!wasLoaded && !restoredFromCache) toast.error(message)
        } finally {
          if (loadingConversationOperationsRef.current.get(conversationId) === loadingOperation) {
            loadingConversationOperationsRef.current.delete(conversationId)
          }
        }
      })()
    },
    [messageManager, updateConversationMessageState],
  )

  const loadBeforeConversationMessages = useCallback(
    (conversationId: string) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!state?.page?.hasMoreBefore || !state.loaded || state.loadingBefore) {
        return
      }

      if (state.viewMode === "history") {
        const version = historyRequestVersionsRef.current.get(conversationId) ?? 0
        const controller = historyRequestControllersRef.current.get(conversationId)
        const targetId = state.historyTarget?.messageId
        if (!controller || !targetId) return
        updateConversationMessageState(conversationId, (current) => ({
          ...current,
          error: null,
          loadingBefore: true,
        }))
        void (async () => {
          try {
            const result = await listConversationMessages(conversationId, {
              beforeSeq: state.page!.oldestSeq,
              limit: messagePageLimit,
              signal: controller.signal,
            })
            if (!historyRequestIsCurrent(conversationId, version)) return
            const current = conversationMessageStatesRef.current[conversationId]
            if (current?.historyTarget?.messageId !== targetId) return
            const operation = messageManager?.beginConversationOperation(conversationId)
            const guard = () =>
              historyRequestIsCurrent(conversationId, version) &&
              conversationMessageStatesRef.current[conversationId]?.historyTarget?.messageId ===
                targetId
            const snapshot = messageManager
              ? await messageManager.mergeHistoryBefore(
                  operation!,
                  result.messages,
                  result.page.hasMoreBefore,
                  guard,
                )
              : null
            if (!historyRequestIsCurrent(conversationId, version)) return
            const messages = snapshot
              ? [...snapshot.messages]
              : mergeConversationMessages(current.messages, result.messages)
            updateConversationMessageState(conversationId, (latest) => ({
              ...latest,
              error: null,
              loaded: true,
              loadingBefore: false,
              messages,
              page: snapshot
                ? {
                    hasMoreAfter: snapshot.hasMoreAfter,
                    hasMoreBefore: snapshot.hasMoreBefore,
                    limit: messagePageLimit,
                    newestSeq: snapshot.newestSeq,
                    oldestSeq: snapshot.oldestSeq,
                  }
                : mergePageWithBeforeResult(latest.page, result.page, messages),
            }))
          } catch (error) {
            if (!historyRequestIsCurrent(conversationId, version)) return
            updateConversationMessageState(conversationId, (current) => ({
              ...current,
              error: getClientDataErrorMessage(error, "加载更早消息失败"),
              loadingBefore: false,
            }))
          }
        })()
        return
      }

      const beforeSeq = state.page.oldestSeq
      let operation: MessageOperationToken | undefined
      try {
        operation = messageManager?.beginConversationOperation(conversationId)
      } catch (error) {
        if (isMessageOperationCancelled(error)) return
        throw error
      }
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        loadingBefore: true,
      }))

      void (async () => {
        let cacheReadFailed = false
        try {
          if (messageManager) {
            try {
              const cached = await messageManager.hydrateBefore(
                operation!,
                beforeSeq,
                messagePageLimit,
              )
              if (cached.hit) {
                updateConversationMessageState(conversationId, (currentState) => ({
                  ...currentState,
                  error: null,
                  loaded: true,
                  loadingBefore: false,
                  messages: cached.messages,
                  page: {
                    hasMoreAfter: currentState.page?.hasMoreAfter ?? false,
                    hasMoreBefore: cached.hasMoreBefore,
                    limit: currentState.page?.limit ?? messagePageLimit,
                    newestSeq: cached.messages.at(-1)?.seq ?? 0,
                    oldestSeq: cached.messages[0]?.seq ?? 0,
                  },
                }))
                return
              }
            } catch (error) {
              if (isMessageOperationCancelled(error)) throw error
              cacheReadFailed = true
            }
          }

          const result = await listConversationMessages(conversationId, {
            beforeSeq,
            limit: messagePageLimit,
          })
          const messages = messageManager
            ? await messageManager.commitBefore(operation!, beforeSeq, result.messages, result.page)
            : mergeConversationMessages(
                conversationMessageStatesRef.current[conversationId]?.messages ?? [],
                result.messages,
              )
          if (operation) messageManager?.assertOperationCurrent(operation)
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: cacheReadFailed ? messageCacheFallbackNotice : null,
            loaded: true,
            loadingBefore: false,
            messages,
            page: mergePageWithBeforeResult(currentState.page, result.page, messages),
          }))
        } catch (error) {
          if (isMessageOperationCancelled(error)) return
          const message = getClientDataErrorMessage(error, "加载更早消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loadingBefore: false,
          }))
          toast.error(message)
        }
      })()
    },
    [historyRequestIsCurrent, messageManager, updateConversationMessageState],
  )

  const loadAfterConversationMessages = useCallback(
    (conversationId: string) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (
        state?.viewMode !== "history" ||
        !state.page?.hasMoreAfter ||
        !state.loaded ||
        state.loadingAfter ||
        !state.historyTarget
      ) {
        return
      }
      const version = historyRequestVersionsRef.current.get(conversationId) ?? 0
      const controller = historyRequestControllersRef.current.get(conversationId)
      const targetId = state.historyTarget.messageId
      if (!controller) return
      updateConversationMessageState(conversationId, (current) => ({
        ...current,
        error: null,
        loadingAfter: true,
      }))
      void (async () => {
        try {
          const result = await listConversationMessages(conversationId, {
            afterSeq: state.page!.newestSeq,
            limit: messagePageLimit,
            signal: controller.signal,
          })
          if (!historyRequestIsCurrent(conversationId, version)) return
          const current = conversationMessageStatesRef.current[conversationId]
          if (current?.historyTarget?.messageId !== targetId) return
          const operation = messageManager?.beginConversationOperation(conversationId)
          const guard = () =>
            historyRequestIsCurrent(conversationId, version) &&
            conversationMessageStatesRef.current[conversationId]?.historyTarget?.messageId ===
              targetId
          const snapshot = messageManager
            ? await messageManager.mergeHistoryAfter(
                operation!,
                result.messages,
                result.page.hasMoreAfter,
                guard,
              )
            : null
          if (!historyRequestIsCurrent(conversationId, version)) return
          const messages = snapshot
            ? [...snapshot.messages]
            : mergeConversationMessages(current.messages, result.messages)
          updateConversationMessageState(conversationId, (latest) => ({
            ...latest,
            error: null,
            loaded: true,
            loadingAfter: false,
            messages,
            page: snapshot
              ? {
                  hasMoreAfter: snapshot.hasMoreAfter,
                  hasMoreBefore: snapshot.hasMoreBefore,
                  limit: messagePageLimit,
                  newestSeq: snapshot.newestSeq,
                  oldestSeq: snapshot.oldestSeq,
                }
              : mergePageWithAfterResult(latest.page, result.page, messages),
          }))
        } catch (error) {
          if (!historyRequestIsCurrent(conversationId, version)) return
          updateConversationMessageState(conversationId, (current) => ({
            ...current,
            error: getClientDataErrorMessage(error, "加载更新消息失败"),
            loadingAfter: false,
          }))
        }
      })()
    },
    [historyRequestIsCurrent, messageManager, updateConversationMessageState],
  )

  const syncAfterConversationMessages = useCallback(
    (
      conversationId: string,
      afterSeq: number,
      trigger: "list-divergence" | "loaded-conversation" | "ready-edge" = "ready-edge",
      listRefreshId?: string,
    ): Promise<void> => {
      const syncOperationId = createDiagnosticId()
      const context = {
        ...(diagnosticTargetScope ? { targetScope: diagnosticTargetScope } : {}),
        ...(listRefreshId ? { listRefreshId } : {}),
        conversationId,
        syncOperationId,
      }
      void recordRendererDiagnostic("message-sync.candidate", context, {
        afterSeq,
        trigger,
      })
      if (syncingAfterConversationOperationsRef.current.has(conversationId)) {
        void recordRendererDiagnostic("message-sync.skipped", context, {
          afterSeq,
          reason: "concurrent",
        })
        return Promise.resolve()
      }

      let operation: MessageOperationToken | undefined
      try {
        operation = messageManager?.beginConversationOperation(conversationId)
      } catch (error) {
        if (isMessageOperationCancelled(error)) {
          void recordRendererDiagnostic("message-sync.cancelled", context, {
            error: { category: "stale", phase: "cache" },
          })
          return Promise.resolve()
        }
        void recordRendererDiagnostic("message-sync.failed", context, {
          error: { category: classifyDiagnosticError(error), phase: "cache" },
        })
        return Promise.reject(error)
      }

      const syncingOperation = Symbol(conversationId)
      syncingAfterConversationOperationsRef.current.set(conversationId, syncingOperation)

      return (async () => {
        const requestIds = new Map<number, string>()
        let pageCount = 0
        const fetchPage = async (cursor: number) => {
          const requestId = createDiagnosticId()
          const requestedAt = performance.now()
          requestIds.set(cursor, requestId)
          void recordRendererDiagnostic(
            "message-sync.page-requested",
            { ...context, requestId },
            {
              afterSeq: cursor,
              endpoint: "message-after-seq",
            },
          )
          const result = await listConversationMessages(conversationId, {
            afterSeq: cursor,
            limit: messagePageLimit,
          })
          pageCount += 1
          void recordRendererDiagnostic(
            "message-sync.page-received",
            { ...context, requestId },
            {
              afterSeq: cursor,
              durationMs: Math.max(0, Math.round(performance.now() - requestedAt)),
              endpoint: "message-after-seq",
              firstReturnedSeq: result.messages[0]?.seq ?? 0,
              responseStatus: 200,
              returnedCount: result.messages.length,
              returnedLastSeq: result.messages.at(-1)?.seq ?? 0,
            },
          )
          return result
        }
        try {
          const initialCursor = messageManager
            ? await messageManager.getSyncCursor(operation!, afterSeq)
            : afterSeq
          void recordRendererDiagnostic("message-sync.started", context, {
            afterSeq,
            initialCursor,
            trigger,
          })
          let completedCursor = initialCursor
          if (messageManager) {
            completedCursor = await messageManager.catchUp(operation!, initialCursor, fetchPage, {
              onCacheCommitted: ({ committedSeq, page, requestAfterSeq }) => {
                const requestId = requestIds.get(requestAfterSeq)
                if (!requestId) return
                void recordRendererDiagnostic(
                  "message-sync.cache-committed",
                  { ...context, requestId },
                  {
                    afterSeq: requestAfterSeq,
                    cacheNewestSeq: page.messages.at(-1)?.seq ?? 0,
                    committedSeq,
                    memoryCursor: committedSeq,
                  },
                )
              },
              onCacheCommitFailed: ({ committedSeq, page, requestAfterSeq }) => {
                const requestId = requestIds.get(requestAfterSeq)
                void recordRendererDiagnostic(
                  "message-cache.state-changed",
                  { ...context, ...(requestId ? { requestId } : {}) },
                  {
                    afterSeq: requestAfterSeq,
                    cacheNewestSeq: page.messages.at(-1)?.seq ?? 0,
                    committedSeq,
                    error: { category: "cache", phase: "cache" },
                    memoryCursor: committedSeq,
                  },
                )
              },
            })
            messageManager.assertOperationCurrent(operation!)
            const messages = messageManager.getMessages(conversationId)
            updateConversationMessageState(conversationId, (currentState) => ({
              ...currentState,
              error: null,
              messages,
              page: mergePageWithAfterResult(
                currentState.page,
                {
                  hasMoreAfter: false,
                  hasMoreBefore: currentState.page?.hasMoreBefore ?? false,
                  limit: messagePageLimit,
                  newestSeq: messages.at(-1)?.seq ?? initialCursor,
                  oldestSeq: messages[0]?.seq ?? 0,
                },
                messages,
              ),
            }))
          } else {
            let accumulatedMessages =
              conversationMessageStatesRef.current[conversationId]?.messages ?? []
            completedCursor = await catchUpConversationMessages({
              afterSeq: initialCursor,
              conversationId,
              fetchPage,
              commit: async (result, cursor) => {
                accumulatedMessages = mergeConversationMessages(
                  accumulatedMessages,
                  result.messages,
                )
                updateConversationMessageState(conversationId, (currentState) => ({
                  ...currentState,
                  error: null,
                  messages: accumulatedMessages,
                  page: mergePageWithAfterResult(
                    currentState.page,
                    result.page,
                    accumulatedMessages,
                  ),
                }))
                const committedSeq = result.messages.reduce(
                  (maximum, message) => Math.max(maximum, message.seq),
                  cursor,
                )
                const requestId = requestIds.get(cursor)
                if (!requestId) return committedSeq
                void recordRendererDiagnostic(
                  "message-sync.cache-committed",
                  { ...context, requestId },
                  {
                    afterSeq: cursor,
                    cacheNewestSeq: result.messages.at(-1)?.seq ?? 0,
                    committedSeq,
                    memoryCursor: committedSeq,
                  },
                )
                return committedSeq
              },
            })
          }
          const lastMessage = conversationMessageStatesRef.current[conversationId]?.messages.at(-1)
          if (lastMessage) rememberConversationMessage(lastMessage)
          const observed = conversationMessageStatesRef.current[conversationId]
          void recordRendererDiagnostic("message-sync.completed", context, {
            committedSeq: completedCursor,
            pageCount,
            pageNewestSeq: observed?.page?.newestSeq ?? 0,
          })
          void recordRendererDiagnostic("message-cache.state-changed", context, {
            cacheNewestSeq: lastMessage?.seq ?? 0,
            httpSyncedThroughSeq: completedCursor,
            memoryCursor: lastMessage?.seq ?? 0,
          })
          void recordRendererDiagnostic("conversation-ui.state-observed", context, {
            displayedNewestSeq: observed?.messages.at(-1)?.seq ?? 0,
            latestKnownSeq: observed?.latestKnownSeq ?? 0,
            loaded: observed?.loaded ?? false,
            pageNewestSeq: observed?.page?.newestSeq ?? 0,
            pendingLatestMessageCount: observed?.pendingLatestMessageCount ?? 0,
            viewMode: observed?.viewMode ?? "latest",
          })
        } catch (error) {
          if (isMessageOperationCancelled(error)) {
            void recordRendererDiagnostic("message-sync.cancelled", context, {
              error: { category: "stale", phase: "cache" },
            })
            return
          }
          if (messageManager) {
            const messages = messageManager.getMessages(conversationId)
            if (messages.length > 0)
              updateConversationMessageState(conversationId, (currentState) => ({
                ...currentState,
                messages,
              }))
          }
          void recordRendererDiagnostic("message-sync.failed", context, {
            error: { category: classifyDiagnosticError(error), phase: "request" },
          })
          toast.error(getClientDataErrorMessage(error, "同步新消息失败"))
        } finally {
          if (
            syncingAfterConversationOperationsRef.current.get(conversationId) === syncingOperation
          ) {
            syncingAfterConversationOperationsRef.current.delete(conversationId)
          }
        }
      })()
    },
    [
      diagnosticTargetScope,
      messageManager,
      rememberConversationMessage,
      updateConversationMessageState,
    ],
  )

  const syncConversationGaps = useCallback(
    (nextConversations: readonly ClientConversation[], listRefreshId?: string) => {
      if (!messageManager) return
      const context = {
        ...(diagnosticTargetScope ? { targetScope: diagnosticTargetScope } : {}),
        ...(listRefreshId ? { listRefreshId } : {}),
      }
      void messageManager
        .listSyncStates()
        .then(async (syncStates) => {
          const statesByConversationId = new Map(
            syncStates.map((state) => [state.conversationId, state]),
          )
          const candidates = prioritizeConversationSyncs(
            nextConversations.filter((conversation) => {
              const syncState = statesByConversationId.get(conversation.id)
              return (
                syncState !== undefined &&
                conversation.lastMessageSeq > syncState.httpSyncedThroughSeq
              )
            }),
            includedConversationIdRef.current,
          )
          for (const conversation of candidates) {
            const state = statesByConversationId.get(conversation.id)
            if (!state) continue
            if (listRefreshId) {
              void recordRendererDiagnostic(
                "conversation-list.seq-diverged",
                { ...context, conversationId: conversation.id },
                {
                  httpSyncedThroughSeq: state.httpSyncedThroughSeq,
                  lastMessageSeq: conversation.lastMessageSeq,
                  seqDelta: conversation.lastMessageSeq - state.httpSyncedThroughSeq,
                },
              )
            }
          }
          let nextIndex = 0
          const runNext = async () => {
            for (;;) {
              const conversation = candidates[nextIndex]
              nextIndex += 1
              if (!conversation) return
              const state = statesByConversationId.get(conversation.id)
              if (!state) continue
              await syncAfterConversationMessages(
                conversation.id,
                state.httpSyncedThroughSeq,
                "list-divergence",
                listRefreshId,
              )
            }
          }
          await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, runNext))
        })
        .catch(() => {
          void recordRendererDiagnostic("message-cache.state-changed", context, {
            error: { category: "cache", phase: "cache" },
          })
        })
    },
    [diagnosticTargetScope, messageManager, syncAfterConversationMessages],
  )
  scheduleConversationGapSyncRef.current = syncConversationGaps

  const syncLoadedConversationMessages = useCallback(() => {
    syncConversationGaps(conversationsRef.current)
    for (const [conversationId, state] of Object.entries(conversationMessageStatesRef.current)) {
      if (!state.loaded) {
        continue
      }

      const newestSeq = getNewestMessageSeq(state)
      if (newestSeq > 0) {
        void syncAfterConversationMessages(conversationId, newestSeq, "loaded-conversation")
      }
      void refreshMessageReactions(
        conversationId,
        state.messages.map((message) => message.id),
      ).catch(() => undefined)
      const choiceMessages = state.messages.filter((message) => message.body.type === "choice")
      for (let index = 0; index < choiceMessages.length; index += choiceSnapshotBatchSize) {
        const batch = choiceMessages.slice(index, index + choiceSnapshotBatchSize)
        const expectedChoices = new Map(batch.map((message) => [message.id, message.choice]))
        void listConversationMessageChoiceSnapshots(
          conversationId,
          batch.map((message) => message.id),
        )
          .then((snapshots) => applyChoiceSnapshots(snapshots, expectedChoices))
          .catch(() => undefined)
      }
    }
  }, [
    applyChoiceSnapshots,
    refreshMessageReactions,
    syncAfterConversationMessages,
    syncConversationGaps,
  ])

  const setForegroundConversationId = useCallback((conversationId: string) => {
    setForegroundConversationIdState(conversationId)
  }, [])

  const {
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationCard,
    sendConversationText,
    sendConversationVoice,
  } = useConversationSenders({
    conversationMessageStatesRef,
    mergeIncomingConversationMessage,
    updateConversationMessageState,
  })

  const {
    addGroupConversationMembers,
    createGroupConversation,
    dissolveGroupConversation,
    getConversation: getRawConversation,
    getConversationMessageState,
    joinGroupConversation,
    leaveGroupConversation,
    openAppConversation,
    openDirectConversation,
    removeConversation,
    restoreConversation,
    removeGroupConversationMember,
    revokeConversationMessage,
    setGroupConversationPrivate,
    setGroupConversationPublic,
    updateGroupConversationAvatar,
    updateGroupConversationAnnouncement,
    updateGroupConversationName,
  } = useConversationActions({
    conversations,
    conversationMessageStates,
    handleError,
    mergeIncomingConversationMessage,
    navigate,
    onConversationsMutated: markConversationsMutated,
    onConversationRemoved: (conversationId) => {
      conversationsNeedingServerRefreshRef.current.delete(conversationId)
      loadingConversationOperationsRef.current.delete(conversationId)
      syncingAfterConversationOperationsRef.current.delete(conversationId)
      void messageManager?.clearConversation(conversationId).catch(() => undefined)
    },
    onConversationRestored: (conversationId) => {
      messageManager?.activateConversation(conversationId)
    },
    refreshContacts,
    setConversationMessageStates,
    setConversations,
  })

  const getConversation = useCallback(
    (conversationId: string) =>
      visibleConversations.find((conversation) => conversation.id === conversationId) ??
      getRawConversation(conversationId),
    [getRawConversation, visibleConversations],
  )

  const dismissConversation = useCallback(
    async (conversationId: string) => {
      try {
        const result = await dismissConversationRequest(conversationId)
        removeConversation(result.conversationId)
      } catch (error) {
        throw handleError(error, "删除对话失败")
      }
    },
    [handleError, removeConversation],
  )

  const bootstrap = useCallback(async () => {
    const contactsRequestEpoch = ++contactsRefreshEpochRef.current
    const minimumLoading = wait(minimumBootstrapLoadingMs)

    try {
      const [nextMe, nextContacts, nextConversations, nextProjects] = await Promise.all([
        getCurrentClientUser(),
        listClientContacts(),
        listClientConversations(undefined, {
          includeConversationId: includedConversationIdRef.current,
        }),
        listClientProjects({ limit: 100 }),
      ])

      await minimumLoading
      setMe(nextMe)
      if (contactsRefreshEpochRef.current === contactsRequestEpoch) {
        setContactApps(nextContacts.apps)
        contactDirectoryModeRef.current = nextContacts.directoryMode
        setContactDirectoryMode(nextContacts.directoryMode)
        setContactGroups(nextContacts.groups)
        userDirectory.seed(nextContacts.initialUsers)
        setContactUserIds(nextContacts.userIds)
        void userDirectory.ensureUsers(nextContacts.userIds).catch(() => undefined)
        if (nextContacts.directoryMode !== "friends") {
          friendRequestsRefreshEpochRef.current += 1
          setFriendRequestsError(null)
          setFriendRequestsLoading(false)
          setIncomingFriendRequests([])
          setOutgoingFriendRequests([])
        } else {
          void refreshFriendRequests(nextContacts.directoryMode).catch(() => undefined)
        }
      }
      setConversations(orderConversations(nextConversations))
      void userDirectory
        .ensureUsers(collectConversationUserIds(nextConversations))
        .catch(() => undefined)
      setPersonalProject(nextProjects.personalProject)
      setProjects(nextProjects.projects)
      setProjectsNextCursor(nextProjects.nextCursor)
      setBootstrapState("ready")
    } catch (error) {
      const requestError = handleError(error, "加载工作区失败")

      if (requestError.status !== 401 && requestError.code !== "unauthorized") {
        await minimumLoading
      }

      setBootstrapError(requestError)
      setBootstrapState("error")
    } finally {
      setMeLoading(false)
      setContactsLoading(false)
      setProjectsLoading(false)
    }
  }, [handleError, refreshFriendRequests, userDirectory])

  const retryBootstrap = useCallback(async () => {
    setBootstrapError(null)
    setBootstrapState("loading")
    setConversations([])
    setConversationMessageStates({})
    setContactApps([])
    contactDirectoryModeRef.current = "organization"
    setContactDirectoryMode("organization")
    setContactGroups([])
    setContactUserIds([])
    setContactsError(null)
    setContactsLoading(true)
    setContactsRefreshing(false)
    friendRequestsRefreshEpochRef.current += 1
    setFriendRequestsError(null)
    setFriendRequestsLoading(false)
    setIncomingFriendRequests([])
    setOutgoingFriendRequests([])
    setPersonalProject(null)
    setProjects([])
    setProjectsError(null)
    setProjectsLoading(true)
    setProjectsLoadingMore(false)
    setProjectsNextCursor(null)
    setProjectsRefreshing(false)
    setMeError(null)
    setMeLoading(true)
    setMeRefreshing(false)

    await bootstrap()
  }, [bootstrap])

  const refreshTasksRef = useRef([
    refreshMe,
    refreshConversations,
    refreshContacts,
    refreshProjects,
  ])
  refreshTasksRef.current = [refreshMe, refreshConversations, refreshContacts, refreshProjects]

  useEffect(() => {
    let active = true

    void Promise.resolve().then(() => {
      if (active) {
        return bootstrap()
      }

      return undefined
    })

    return () => {
      active = false
    }
  }, [bootstrap])

  useEffect(() => {
    if (bootstrapState !== "ready") {
      return
    }

    const poller = startStaggeredRefresh(
      refreshTasksRef.current.map((_task, index) => () => refreshTasksRef.current[index]()),
      refreshIntervalMs,
    )

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        poller.refreshNext()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("magicchat:realtime-ready", poller.refreshNext)

    return () => {
      poller.stop()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("magicchat:realtime-ready", poller.refreshNext)
    }
  }, [bootstrapState])

  if (bootstrapState === "loading") {
    return <ClientLoadingPage />
  }

  if (bootstrapState === "error") {
    return (
      <ClientDataErrorPage
        message={bootstrapError?.message ?? "加载工作区失败"}
        onRetry={() => void retryBootstrap()}
        workspaceErrorAction={workspaceErrorAction}
      />
    )
  }

  if (!me || !personalProject) {
    return <ClientLoadingPage />
  }

  const value: ClientDataContextValue = {
    addGroupConversationMembers,
    contactApps,
    contactDirectoryMode,
    contactGroups: visibleContactGroups,
    conversations: visibleConversations,
    contacts,
    contactsError,
    contactsLoading,
    contactsRefreshing,
    friendRequestsError,
    friendRequestsLoading,
    incomingFriendRequests,
    outgoingFriendRequests,
    usersById,
    createGroupConversation,
    createFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    deleteFriend,
    createProject,
    compactConversationMessages,
    consumeConversationMessageFocus,
    clearMessageScope,
    dissolveGroupConversation,
    dismissConversation,
    ensureConversationMessages,
    focusConversationMessage,
    foregroundConversationId,
    getConversation,
    getUser,
    ensureUsers,
    invalidateUsers,
    updateUserPresence,
    getConversationMessageState,
    joinGroupConversation,
    leaveGroupConversation,
    loadBeforeConversationMessages,
    loadAfterConversationMessages,
    markConversationRead,
    setConversationPinned,
    setConversationMuted,
    handleIncomingConversationMessage,
    handleIncomingConversationMessageUpdate,
    handleIncomingMessageChoiceUpdate,
    handleIncomingMessageReactionsUpdate,
    me,
    meError,
    meLoading,
    meRefreshing,
    mergeIncomingConversationMessage,
    openAppConversation,
    openDirectConversation,
    personalProject,
    projects,
    projectsError,
    projectsLoading,
    projectsLoadingMore,
    projectsNextCursor,
    projectsRefreshing,
    refreshConversations,
    refreshContacts,
    refreshFriendData,
    refreshMe,
    refreshProjects,
    replaceWithLatestMessages,
    registerConversationMessageView,
    loadMoreProjects,
    removeConversation,
    restoreConversation,
    removeGroupConversationMember,
    revokeConversationMessage,
    respondToChoice,
    setMessageReaction,
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationCard,
    sendConversationText,
    sendConversationVoice,
    setForegroundConversationId,
    setGroupConversationPrivate,
    setGroupConversationPublic,
    syncLoadedConversationMessages,
    updateConversationLastMessage,
    updateConversationLastMentionedSeq,
    updateConversationLastChoiceSeq,
    updateConversationPinned,
    updateConversationMuted,
    updateMessageTopic,
    updateGroupConversationAvatar,
    updateGroupConversationAnnouncement,
    updateGroupConversationName,
  }

  return <ClientDataContext.Provider value={value}>{children}</ClientDataContext.Provider>
}

function getConversationLastMessageSender(
  conversation: ClientConversation,
  message: ClientMessage,
): ClientConversation["lastMessageSender"] {
  if (message.sender.type === "system") {
    return { id: "", name: "系统", nickname: "", type: "system" }
  }

  const member = conversation.members?.find(
    (candidate) => candidate.type === message.sender.type && candidate.id === message.sender.id,
  )

  return {
    id: message.sender.id,
    name: member?.name ?? "",
    nickname: member?.nickname ?? "",
    type: message.sender.type,
  }
}

function createContactPlaceholder(id: string): ContactUser {
  return {
    avatar: "",
    email: "",
    id,
    lastOnlineAt: null,
    name: shortUserId(id),
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}

function shortUserId(userId: string) {
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}...${userId.slice(-4)}`
}

function collectConversationUserIds(conversations: readonly ClientConversation[]) {
  const userIds = new Set<string>()
  for (const conversation of conversations) {
    for (const member of conversation.members ?? []) {
      if (member.type === "user") userIds.add(member.id)
    }
    if (conversation.lastMessageSender?.type === "user" && conversation.lastMessageSender.id) {
      userIds.add(conversation.lastMessageSender.id)
    }
    if (conversation.topic?.sourceSender.type === "user")
      userIds.add(conversation.topic.sourceSender.id)
  }
  return [...userIds]
}

function collectConversationMessageUserIds(
  conversationMessageStates: Readonly<Record<string, ClientConversationMessageState>>,
) {
  const userIds = new Set<string>()
  for (const state of Object.values(conversationMessageStates)) {
    for (const message of state.messages) {
      if (message.sender.type === "user" && message.sender.id) userIds.add(message.sender.id)
      if (message.replyTo?.sender.type === "user" && message.replyTo.sender.id) {
        userIds.add(message.replyTo.sender.id)
      }
      for (const reply of message.topic?.recentReplies ?? []) {
        if (reply.sender.type === "user" && reply.sender.id) userIds.add(reply.sender.id)
      }
    }
  }
  return [...userIds]
}

function collectContactGroupUserIds(groups: readonly ContactGroup[]) {
  const userIds = new Set<string>()
  for (const group of groups) {
    for (const member of group.avatarMembers) {
      if (member.type === "user" && member.id) userIds.add(member.id)
    }
  }
  return [...userIds]
}

function hydrateContactGroupUsers(
  groups: readonly ContactGroup[],
  apps: readonly ContactApp[],
  usersById: Readonly<Record<string, ContactUser>>,
) {
  const appsById = Object.fromEntries(apps.map((app) => [app.id, app]))
  return groups.map((group) => ({
    ...group,
    avatarMembers: group.avatarMembers.map((member) => {
      const profile = conversationIdentityProfile(member.type, member.id, usersById, appsById)
      if (!profile) return member
      if (
        member.avatar === profile.avatar &&
        member.name === profile.name &&
        member.nickname === profile.nickname
      ) {
        return member
      }
      return {
        ...member,
        avatar: profile.avatar,
        name: profile.name,
        nickname: profile.nickname,
      }
    }),
  }))
}

function hydrateConversationUsers(
  conversation: ClientConversation,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: Readonly<Record<string, ContactApp>>,
) {
  let changed = false
  const members = conversation.members?.map((member) => {
    const profile = conversationIdentityProfile(member.type, member.id, usersById, appsById)
    if (!profile) return member
    const next = {
      ...member,
      avatar: profile.avatar,
      email: profile.email,
      name: profile.name,
      nickname: profile.nickname,
      phone: profile.phone,
    }
    if (
      next.avatar === member.avatar &&
      next.email === member.email &&
      next.name === member.name &&
      next.nickname === member.nickname &&
      next.phone === member.phone
    ) {
      return member
    }
    changed = true
    return next
  })
  let lastMessageSender = conversation.lastMessageSender
  if (lastMessageSender) {
    const profile = conversationIdentityProfile(
      lastMessageSender.type,
      lastMessageSender.id,
      usersById,
      appsById,
    )
    if (
      profile &&
      (lastMessageSender.name !== profile.name || lastMessageSender.nickname !== profile.nickname)
    ) {
      changed = true
      lastMessageSender = {
        ...lastMessageSender,
        name: profile.name,
        nickname: profile.nickname,
      }
    }
  }
  let topic = conversation.topic
  if (topic) {
    const profile = conversationIdentityProfile(
      topic.sourceSender.type,
      topic.sourceSender.id,
      usersById,
      appsById,
    )
    if (
      profile &&
      (topic.sourceSender.avatar !== profile.avatar || topic.sourceSender.name !== profile.name)
    ) {
      changed = true
      topic = {
        ...topic,
        sourceSender: {
          ...topic.sourceSender,
          avatar: profile.avatar,
          name: profile.name,
        },
      }
    }
  }
  return changed ? { ...conversation, lastMessageSender, members, topic } : conversation
}

function conversationIdentityProfile(
  type: "app" | "system" | "user",
  id: string,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: Readonly<Record<string, ContactApp>>,
) {
  if (type === "user") {
    const user = usersById[id]
    return user
      ? {
          avatar: user.avatar,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          phone: user.phone,
        }
      : undefined
  }
  if (type === "app") {
    const app = appsById[id]
    return app
      ? { avatar: app.avatar, email: "", name: app.name, nickname: "", phone: "" }
      : undefined
  }
  return undefined
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
