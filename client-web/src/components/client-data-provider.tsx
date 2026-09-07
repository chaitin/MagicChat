import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { matchPath, useLocation, useNavigate } from "react-router"

import {
  ClientDataRequestError,
  acceptFriendRequest as acceptFriendRequestRequest,
  cancelFriendRequest as cancelFriendRequestRequest,
  createFriendRequest as createFriendRequestRequest,
  deleteFriend as deleteFriendRequest,
  dismissConversation as dismissConversationRequest,
  getCurrentClientUser,
  isClientMessageInitiatedByUser,
  listClientContacts,
  listClientConversations,
  listConversationMessages,
  listFriendRequests,
  listConversationMessageChoiceSnapshots,
  listConversationMessageReactionSnapshots,
  markConversationRead as markConversationReadRequest,
  rejectFriendRequest as rejectFriendRequestRequest,
  resolveClientUsers,
  setConversationMessageReaction as setConversationMessageReactionRequest,
  submitConversationMessageChoiceResponse,
  setConversationMuted as setConversationMutedRequest,
  setConversationPinned as setConversationPinnedRequest,
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
  type MessageChoiceSnapshot,
  type MessageChoiceUpdatedEvent,
  type MessageReactionSnapshot,
} from "@/lib/client-data-api"
import {
  ClientDataContext,
  type ClientConversationMessageState,
  type ClientDataContextValue,
} from "@/lib/client-data-context"
import { ClientProfileProvider } from "@/components/client-profile-provider"
import {
  clearConversationRemovalState,
  compactConversationMessageState,
  createConversationMessageState,
  applyMessageChoiceSnapshot,
  applyMessageReactionSnapshot,
  applyMessageChoiceState,
  applyMessageReactionsUpdate,
  getMessageSummary,
  getNewestMessageSeq,
  mergeBootstrapConversationMessageStates,
  mergeConversationMessages,
  mergeConversationSnapshot,
  mergeLatestCachedMessages,
  isLatestConversationSnapshot,
  orderConversations,
  shouldReplaceConversationSnapshot,
  updatePageWithMessage,
} from "@/lib/client-data-state"
import {
  createClientProject as createClientProjectRequest,
  listClientProjects,
  type ClientProjectDetail,
  type ClientProjectSummary,
} from "@/lib/project-data-api"
import { Button } from "@/components/ui/button"
import { ClientLoadingPage } from "@/components/client-loading-page"
import { useConversationActions } from "@/hooks/use-conversation-actions"
import { useConversationMessageRetention } from "@/hooks/use-conversation-message-retention"
import { useConversationMessageWindow } from "@/hooks/use-conversation-message-window"
import { useConversationSenders } from "@/hooks/use-conversation-senders"
import { useAppInfo } from "@/lib/app-info-context"

type BootstrapState = "loading" | "ready" | "error"

const minimumBootstrapLoadingMs = 1_000
const refreshIntervalMs = 15_000
const reactionSnapshotBatchSize = 100
const choiceSnapshotBatchSize = 100
const bootstrapMessageConcurrency = 5
const bootstrapMessageLimit = 20
const bootstrapConversationLimit = 30
const bootstrapMessageTimeoutMs = 30_000
const maxReactionSnapshotCatchUpAttempts = 3
const userProfileCacheTtlMs = 5 * 60 * 1_000
const unavailableUserCacheTtlMs = 30 * 1_000
const userResolveBatchSize = 100

type CachedUserProfile = {
  fetchedAt: number
  profile: ContactUser
  updatedAt: string
}

type UserProfileDeferred = {
  promise: Promise<void>
  reject: (error: unknown) => void
  resolve: () => void
}

export function ClientDataProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { setAuthenticated } = useAppInfo()
  const [bootstrapError, setBootstrapError] =
    useState<ClientDataRequestError | null>(null)
  const [bootstrapState, setBootstrapState] =
    useState<BootstrapState>("loading")
  const [conversations, setConversations] = useState<ClientConversation[]>([])
  const [conversationMessageStates, setConversationMessageStates] = useState<
    Record<string, ClientConversationMessageState>
  >({})
  const [latestCachedMessages, setLatestCachedMessages] = useState<
    Record<string, ClientMessage>
  >({})
  const [foregroundConversationId, setForegroundConversationId] = useState("")
  const shouldLoadConversations =
    !location.pathname.startsWith("/tasks") &&
    !location.pathname.startsWith("/documents/")
  const routeConversationId =
    matchPath("/chat/:conversationId", location.pathname)?.params
      .conversationId ?? ""
  const includedConversationId = foregroundConversationId || routeConversationId
  const includedConversationIdRef = useRef(includedConversationId)
  useEffect(() => {
    includedConversationIdRef.current = includedConversationId
  }, [includedConversationId])
  const [contactApps, setContactApps] = useState<ContactApp[]>([])
  const [contactDirectoryMode, setContactDirectoryMode] =
    useState<ContactDirectoryMode>("organization")
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([])
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<
    FriendRequest[]
  >([])
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<
    FriendRequest[]
  >([])
  const [contactUserIds, setContactUserIds] = useState<string[]>([])
  const [contactsError, setContactsError] =
    useState<ClientDataRequestError | null>(null)
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsRefreshing, setContactsRefreshing] = useState(false)
  const [usersById, setUsersById] = useState<Record<string, ContactUser>>({})
  const contacts = useMemo(
    () =>
      contactUserIds.flatMap((id) => {
        const user = usersById[id]
        return user ? [user] : []
      }),
    [contactUserIds, usersById]
  )
  const visibleContactGroups = useMemo(
    () => hydrateContactGroupUsers(contactGroups, contactApps, usersById),
    [contactApps, contactGroups, usersById]
  )
  const visibleConversations = useMemo(() => {
    const appsById = Object.fromEntries(contactApps.map((app) => [app.id, app]))
    return conversations.map((conversation) =>
      hydrateConversationUsers(conversation, usersById, appsById)
    )
  }, [contactApps, conversations, usersById])
  const visibleConversationMessageStates = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(conversationMessageStates).map(
          ([conversationId, state]) => [
            conversationId,
            {
              ...state,
              messages: state.messages.map((message) =>
                hydrateMessageUsers(message, usersById)
              ),
            },
          ]
        )
      ),
    [conversationMessageStates, usersById]
  )
  const userCacheRef = useRef<Map<string, CachedUserProfile>>(new Map())
  const unavailableUsersRef = useRef<Map<string, number>>(new Map())
  const requiredUserVersionsRef = useRef<Map<string, string>>(new Map())
  const pendingUserIdsRef = useRef<Set<string>>(new Set())
  const ensureUsersRef = useRef<(userIds: string[]) => Promise<void>>(
    async () => undefined
  )
  const userDeferredsRef = useRef<Map<string, UserProfileDeferred>>(new Map())
  const userFlushScheduledRef = useRef(false)
  const [me, setMe] = useState<ClientUser | null>(null)
  const [meError, setMeError] = useState<ClientDataRequestError | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [meRefreshing, setMeRefreshing] = useState(false)
  const [personalProject, setPersonalProject] =
    useState<ClientProjectSummary | null>(null)
  const [projects, setProjects] = useState<ClientProjectSummary[]>([])
  const [projectsError, setProjectsError] =
    useState<ClientDataRequestError | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsLoadingMore, setProjectsLoadingMore] = useState(false)
  const [projectsNextCursor, setProjectsNextCursor] = useState<string | null>(
    null
  )
  const [projectsRefreshing, setProjectsRefreshing] = useState(false)
  const conversationMessageStatesRef = useRef(conversationMessageStates)
  const conversationsRef = useRef(conversations)
  const removedConversationIdsRef = useRef<Set<string>>(new Set())
  const removedConversationsRef = useRef<Map<string, ClientConversation>>(
    new Map()
  )
  const conversationSnapshotSequenceRef = useRef(0)
  const conversationAccountIdRef = useRef<string | null>(null)
  const conversationAccountGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const bootstrapGenerationRef = useRef(0)
  const refreshingReactionSnapshotKeysRef = useRef<Set<string>>(new Set())
  const reactionSnapshotMinimumVersionsRef = useRef<Map<string, number>>(
    new Map()
  )
  const { applyConversationMessageRetention, registerConversationMessageView } =
    useConversationMessageRetention()

  useEffect(() => {
    conversationMessageStatesRef.current = visibleConversationMessageStates
  }, [visibleConversationMessageStates])

  useEffect(() => {
    conversationsRef.current = visibleConversations
  }, [visibleConversations])

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      bootstrapGenerationRef.current += 1
    }
  }, [])

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

        setAuthenticated(false)
        conversationAccountIdRef.current = null
        clearConversationRemovalState(
          removedConversationIdsRef.current,
          removedConversationsRef.current
        )
        ++conversationSnapshotSequenceRef.current
        setConversations([])
        setConversationMessageStates({})
        setContactApps([])
        setContactDirectoryMode("organization")
        setContactGroups([])
        setIncomingFriendRequests([])
        setOutgoingFriendRequests([])
        setContactUserIds([])
        setUsersById({})
        userCacheRef.current.clear()
        unavailableUsersRef.current.clear()
        requiredUserVersionsRef.current.clear()
        setPersonalProject(null)
        setProjects([])
        setMe(null)
        navigate("/login", { replace: true })
      }

      return requestError
    },
    [navigate, setAuthenticated]
  )

  const cacheUserProfiles = useCallback(
    (profiles: ContactUser[], updatedAt = "") => {
      const now = Date.now()
      let changed = false
      for (const profile of profiles) {
        const current = userCacheRef.current.get(profile.id)
        if (
          current &&
          updatedAt &&
          current.updatedAt &&
          compareUserVersions(current.updatedAt, updatedAt) > 0
        ) {
          continue
        }
        const requiredVersion = requiredUserVersionsRef.current.get(profile.id)
        if (
          requiredVersion &&
          (!updatedAt || compareUserVersions(updatedAt, requiredVersion) < 0)
        ) {
          continue
        }
        userCacheRef.current.set(profile.id, {
          fetchedAt: now,
          profile,
          updatedAt: updatedAt || current?.updatedAt || "",
        })
        unavailableUsersRef.current.delete(profile.id)
        if (requiredVersion) requiredUserVersionsRef.current.delete(profile.id)
        changed = true
      }
      if (changed) {
        setUsersById(
          Object.fromEntries(
            Array.from(userCacheRef.current, ([id, value]) => [
              id,
              value.profile,
            ])
          )
        )
      }
    },
    []
  )

  const flushPendingUsers = useCallback(async () => {
    userFlushScheduledRef.current = false
    const ids = Array.from(pendingUserIdsRef.current)
    pendingUserIdsRef.current.clear()
    for (let index = 0; index < ids.length; index += userResolveBatchSize) {
      const batch = ids.slice(index, index + userResolveBatchSize)
      try {
        const users = await resolveClientUsers(batch)
        const returnedIds = new Set(users.map((user) => user.id))
        const staleIds: string[] = []
        for (const user of users) {
          const requiredVersion = requiredUserVersionsRef.current.get(user.id)
          cacheUserProfiles([user], user.updatedAt)
          if (
            requiredVersion &&
            compareUserVersions(user.updatedAt, requiredVersion) < 0
          ) {
            staleIds.push(user.id)
          }
        }
        const unavailableUntil = Date.now() + unavailableUserCacheTtlMs
        let removedCachedUser = false
        for (const id of batch) {
          if (!returnedIds.has(id)) {
            unavailableUsersRef.current.set(id, unavailableUntil)
            requiredUserVersionsRef.current.delete(id)
            removedCachedUser =
              userCacheRef.current.delete(id) || removedCachedUser
          }
          userDeferredsRef.current.get(id)?.resolve()
          userDeferredsRef.current.delete(id)
        }
        if (removedCachedUser) {
          setUsersById(
            Object.fromEntries(
              Array.from(userCacheRef.current, ([id, value]) => [
                id,
                value.profile,
              ])
            )
          )
        }
        if (staleIds.length > 0) {
          window.setTimeout(() => {
            void ensureUsersRef.current(staleIds).catch(() => undefined)
          }, 50)
        }
      } catch (error) {
        const requestError = handleError(error, "加载用户资料失败")
        for (const id of batch) {
          userDeferredsRef.current.get(id)?.reject(requestError)
          userDeferredsRef.current.delete(id)
        }
      }
    }
  }, [cacheUserProfiles, handleError])

  const ensureUsers = useCallback(
    async (rawUserIds: string[]) => {
      const now = Date.now()
      const promises: Promise<void>[] = []
      for (const id of new Set(rawUserIds.map((value) => value.trim()))) {
        if (!id) continue
        const cached = userCacheRef.current.get(id)
        if (cached && now - cached.fetchedAt < userProfileCacheTtlMs) continue
        const unavailableUntil = unavailableUsersRef.current.get(id) ?? 0
        if (unavailableUntil > now) continue
        let deferred = userDeferredsRef.current.get(id)
        if (!deferred) {
          let resolve!: () => void
          let reject!: (error: unknown) => void
          const promise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise
            reject = rejectPromise
          })
          deferred = { promise, reject, resolve }
          userDeferredsRef.current.set(id, deferred)
          pendingUserIdsRef.current.add(id)
        }
        promises.push(deferred.promise)
      }
      if (
        pendingUserIdsRef.current.size > 0 &&
        !userFlushScheduledRef.current
      ) {
        userFlushScheduledRef.current = true
        queueMicrotask(() => void flushPendingUsers())
      }
      await Promise.all(promises)
    },
    [flushPendingUsers]
  )
  useEffect(() => {
    ensureUsersRef.current = ensureUsers
  }, [ensureUsers])

  const getUser = useCallback(
    (userId: string) => userCacheRef.current.get(userId)?.profile,
    []
  )

  const invalidateUsers = useCallback(
    (userIds: string[], updatedAt = "") => {
      const refreshIds: string[] = []
      for (const id of userIds) {
        const cached = userCacheRef.current.get(id)
        const pending = userDeferredsRef.current.has(id)
        if (!cached && !pending) continue
        if (updatedAt) {
          const currentRequired = requiredUserVersionsRef.current.get(id)
          if (
            !currentRequired ||
            compareUserVersions(updatedAt, currentRequired) > 0
          ) {
            requiredUserVersionsRef.current.set(id, updatedAt)
          }
        }
        if (cached) cached.fetchedAt = 0
        unavailableUsersRef.current.delete(id)
        refreshIds.push(id)
      }
      if (refreshIds.length > 0) {
        void ensureUsers(refreshIds).catch(() => undefined)
      }
    },
    [ensureUsers]
  )

  const updateUserPresence = useCallback(
    (userId: string, online: boolean, lastOnlineAt?: string | null) => {
      const cached = userCacheRef.current.get(userId)
      if (!cached) return
      const profile = {
        ...cached.profile,
        lastOnlineAt:
          lastOnlineAt === undefined
            ? cached.profile.lastOnlineAt
            : lastOnlineAt,
        online,
      }
      userCacheRef.current.set(userId, { ...cached, profile })
      setUsersById((current) => ({ ...current, [userId]: profile }))
    },
    []
  )

  useEffect(() => {
    const userIds = conversations.flatMap((conversation) =>
      conversationUserIDs(conversation)
    )
    if (userIds.length > 0) void ensureUsers(userIds).catch(() => undefined)
  }, [conversations, ensureUsers])

  useEffect(() => {
    const userIds = Object.values(conversationMessageStates).flatMap((state) =>
      state.messages.flatMap(messageUserIDs)
    )
    if (userIds.length > 0) void ensureUsers(userIds).catch(() => undefined)
  }, [conversationMessageStates, ensureUsers])

  const refreshMe = useCallback(async () => {
    const isInitialLoad = me === null
    setMeError(null)
    setMeLoading(isInitialLoad)
    setMeRefreshing(!isInitialLoad)

    try {
      const user = await getCurrentClientUser()
      setMe(user)
      cacheUserProfiles([
        {
          avatar: user.avatar,
          email: user.email,
          id: user.id,
          lastOnlineAt: user.lastOnlineAt,
          name: user.name,
          nickname: user.nickname,
          online: true,
          phone: user.phone,
          type: "user",
        },
      ])
    } catch (error) {
      const requestError = handleError(error, "加载当前用户失败")
      setMeError(requestError)
      throw requestError
    } finally {
      setMeLoading(false)
      setMeRefreshing(false)
    }
  }, [cacheUserProfiles, handleError, me])

  const refreshFriendRequests = useCallback(async () => {
    try {
      const [incoming, outgoing] = await Promise.all([
        listFriendRequests("incoming"),
        listFriendRequests("outgoing"),
      ])
      setIncomingFriendRequests(incoming)
      setOutgoingFriendRequests(outgoing)
      await ensureUsers([
        ...incoming.flatMap((request) => [
          request.requesterUserId,
          request.addresseeUserId,
        ]),
        ...outgoing.flatMap((request) => [
          request.requesterUserId,
          request.addresseeUserId,
        ]),
      ])
    } catch (error) {
      throw handleError(error, "加载好友申请失败")
    }
  }, [ensureUsers, handleError])

  const refreshContacts = useCallback(async () => {
    const isInitialLoad =
      contacts.length === 0 &&
      contactApps.length === 0 &&
      contactGroups.length === 0
    setContactsError(null)
    setContactsLoading(isInitialLoad)
    setContactsRefreshing(!isInitialLoad)

    try {
      const nextContacts = await listClientContacts()
      setContactApps(nextContacts.apps)
      setContactDirectoryMode(nextContacts.directoryMode)
      setContactGroups(nextContacts.groups)
      setContactUserIds(nextContacts.userIds)
      await ensureUsers(nextContacts.userIds)
      if (nextContacts.directoryMode === "friends") {
        await refreshFriendRequests()
      } else {
        setIncomingFriendRequests([])
        setOutgoingFriendRequests([])
      }
    } catch (error) {
      const requestError = handleError(error, "加载通讯录失败")
      setContactsError(requestError)
      throw requestError
    } finally {
      setContactsLoading(false)
      setContactsRefreshing(false)
    }
  }, [
    contactApps.length,
    contactGroups.length,
    contacts.length,
    ensureUsers,
    handleError,
    refreshFriendRequests,
  ])

  const createFriendRequest = useCallback(
    async (userId: string) => {
      try {
        await createFriendRequestRequest(userId)
        await refreshContacts()
      } catch (error) {
        throw handleError(error, "发送好友申请失败")
      }
    },
    [handleError, refreshContacts]
  )

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await acceptFriendRequestRequest(requestId)
        await refreshContacts()
      } catch (error) {
        throw handleError(error, "接受好友申请失败")
      }
    },
    [handleError, refreshContacts]
  )

  const rejectFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await rejectFriendRequestRequest(requestId)
        await refreshFriendRequests()
      } catch (error) {
        throw handleError(error, "拒绝好友申请失败")
      }
    },
    [handleError, refreshFriendRequests]
  )

  const cancelFriendRequest = useCallback(
    async (requestId: string) => {
      try {
        await cancelFriendRequestRequest(requestId)
        await refreshFriendRequests()
      } catch (error) {
        throw handleError(error, "取消好友申请失败")
      }
    },
    [handleError, refreshFriendRequests]
  )

  const deleteFriend = useCallback(
    async (userId: string) => {
      try {
        await deleteFriendRequest(userId)
        await refreshContacts()
      } catch (error) {
        throw handleError(error, "删除好友失败")
      }
    },
    [handleError, refreshContacts]
  )

  const refreshConversations = useCallback(async () => {
    const sequence = ++conversationSnapshotSequenceRef.current
    try {
      const snapshot = await listClientConversations(undefined, {
        includeConversationId: includedConversationIdRef.current,
      })
      if (
        !isLatestConversationSnapshot(
          sequence,
          conversationSnapshotSequenceRef.current
        )
      )
        return
      setConversations((current) =>
        mergeConversationSnapshot(
          current,
          snapshot,
          removedConversationIdsRef.current
        )
      )
    } catch (error) {
      throw handleError(error, "加载会话列表失败")
    }
  }, [handleError])

  const refreshRestoredConversation = useCallback(
    async (conversationId: string) => {
      removedConversationIdsRef.current.delete(conversationId)
      const cachedConversation =
        removedConversationsRef.current.get(conversationId)
      removedConversationsRef.current.delete(conversationId)
      if (cachedConversation) {
        setConversations((current) =>
          mergeConversationSnapshot(current, [cachedConversation])
        )
      }
      await refreshConversations()
    },
    [refreshConversations]
  )

  const refreshProjects = useCallback(async () => {
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
  }, [handleError, personalProject, projects.length])

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
        const projectById = new Map(
          currentProjects.map((project) => [project.id, project])
        )

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
    [handleError, refreshProjects]
  )

  const updateConversationMessageState = useCallback(
    (
      conversationId: string,
      updater: (
        state: ClientConversationMessageState
      ) => ClientConversationMessageState
    ) => {
      setConversationMessageStates((currentStates) => {
        const previousState =
          currentStates[conversationId] ?? createConversationMessageState()
        const updatedState = updater(previousState)
        const nextState = applyConversationMessageRetention(
          conversationId,
          updatedState
        )

        return {
          ...currentStates,
          [conversationId]: nextState,
        }
      })
    },
    [applyConversationMessageRetention]
  )

  const consumeConversationMessageFocus = useCallback(
    (conversationId: string, requestKey: number) => {
      updateConversationMessageState(conversationId, (currentState) =>
        currentState.focus?.requestKey === requestKey
          ? { ...currentState, focus: null }
          : currentState
      )
    },
    [updateConversationMessageState]
  )

  const compactConversationMessages = useCallback((conversationId: string) => {
    if (!conversationId) {
      return
    }

    setConversationMessageStates((currentStates) => {
      const currentState = currentStates[conversationId]
      if (!currentState) {
        return currentStates
      }
      const nextState = compactConversationMessageState(currentState)
      return nextState === currentState
        ? currentStates
        : { ...currentStates, [conversationId]: nextState }
    })
  }, [])

  const applyConversationMessageToList = useCallback(
    (message: ClientMessage, options: { countUnread?: boolean } = {}) => {
      const conversationExists = conversationsRef.current.some(
        (conversation) => conversation.id === message.conversationId
      )

      setConversations((currentConversations) => {
        const conversation = currentConversations.find(
          (currentConversation) =>
            currentConversation.id === message.conversationId
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
          lastMessageSender: getConversationLastMessageSender(
            conversation,
            message
          ),
          lastMessageSummary: getMessageSummary(message),
          unreadCount: shouldIncrementUnread
            ? conversation.unreadCount + 1
            : conversation.unreadCount,
        }

        return orderConversations([
          updatedConversation,
          ...currentConversations.filter(
            (currentConversation) =>
              currentConversation.id !== message.conversationId
          ),
        ])
      })

      if (!conversationExists) {
        void refreshConversations().catch(() => undefined)
      }
    },
    [refreshConversations]
  )

  const updateConversationLastMessage = useCallback(
    (message: ClientMessage) => {
      applyConversationMessageToList(message)
    },
    [applyConversationMessageToList]
  )

  const saveLatestCachedMessage = useCallback((message: ClientMessage) => {
    setLatestCachedMessages((current) => {
      const cached = current[message.conversationId]
      return cached && cached.seq >= message.seq
        ? current
        : { ...current, [message.conversationId]: message }
    })
  }, [])

  const rememberConversationMessage = useCallback(
    (message: ClientMessage) => {
      saveLatestCachedMessage(message)
      applyConversationMessageToList(message)
    },
    [applyConversationMessageToList, saveLatestCachedMessage]
  )

  const getLatestCachedMessage = useCallback(
    (conversationId: string) => latestCachedMessages[conversationId],
    [latestCachedMessages]
  )

  const getConversationLatestSeq = useCallback(
    (conversationId: string) =>
      conversationsRef.current.find(
        (conversation) => conversation.id === conversationId
      )?.lastMessageSeq ?? 0,
    []
  )
  const {
    ensureConversationMessages,
    focusConversationMessage,
    invalidateConversationMessageRequests,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    returnToLatestConversationMessages,
    syncAfterConversationMessages,
  } = useConversationMessageWindow({
    conversationMessageStates,
    conversationMessageStatesRef,
    getConversationLatestSeq,
    rememberConversationMessage,
    updateConversationMessageState,
  })

  const updateTopicSourcePreview = useCallback((message: ClientMessage) => {
    const topicConversation = conversationsRef.current.find(
      (conversation) =>
        conversation.id === message.conversationId &&
        conversation.type === "topic"
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
        if (
          sourceMessage.id !== topic.sourceMessageId ||
          !sourceMessage.topic
        ) {
          return sourceMessage
        }
        const existingReplies = (
          sourceMessage.topic.recentReplies ?? []
        ).filter((reply) => reply.id !== message.id)
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
    (
      message: ClientMessage,
      options: { markLoaded?: boolean; updateList?: boolean } = {}
    ) => {
      updateConversationMessageState(message.conversationId, (state) => {
        if (
          state.viewMode === "history" &&
          message.seq > (state.page?.newestSeq ?? 0)
        ) {
          const isNewLatestMessage = message.seq > state.latestKnownSeq
          return {
            ...state,
            error: null,
            latestKnownSeq: Math.max(state.latestKnownSeq, message.seq),
            pendingLatestMessageCount:
              state.pendingLatestMessageCount + (isNewLatestMessage ? 1 : 0),
          }
        }
        const messages = mergeConversationMessages(state.messages, [message])

        return {
          ...state,
          error: null,
          latestKnownSeq: Math.max(state.latestKnownSeq, message.seq),
          loaded: options.markLoaded ? true : state.loaded,
          messages,
          page:
            state.viewMode === "history"
              ? state.page
              : updatePageWithMessage(state.page, messages),
        }
      })
      updateTopicSourcePreview(message)
      if (options.updateList !== false) {
        rememberConversationMessage(message)
      }
    },
    [
      rememberConversationMessage,
      updateConversationMessageState,
      updateTopicSourcePreview,
    ]
  )

  const currentUserId = me?.id ?? ""
  const refreshMessageReactions = useCallback(
    async (conversationId: string, rawMessageIds: string[]) => {
      const messageIds = [...new Set(rawMessageIds)].filter((messageId) => {
        const key = `${conversationId}:${messageId}`
        return !refreshingReactionSnapshotKeysRef.current.has(key)
      })
      const batches: string[][] = []
      for (
        let index = 0;
        index < messageIds.length;
        index += reactionSnapshotBatchSize
      ) {
        batches.push(messageIds.slice(index, index + reactionSnapshotBatchSize))
      }

      await Promise.all(
        batches.map(async (initialBatch) => {
          let batch = initialBatch
          let attempts = 0
          while (
            batch.length > 0 &&
            attempts < maxReactionSnapshotCatchUpAttempts
          ) {
            attempts += 1
            for (const messageId of batch) {
              refreshingReactionSnapshotKeysRef.current.add(
                `${conversationId}:${messageId}`
              )
            }
            let snapshots: MessageReactionSnapshot[]
            try {
              snapshots = await listConversationMessageReactionSnapshots(
                conversationId,
                batch
              )
              setConversationMessageStates((currentStates) => {
                const state = currentStates[conversationId]
                if (!state) return currentStates
                const snapshotsByMessageId = new Map(
                  snapshots.map((snapshot) => [snapshot.messageId, snapshot])
                )
                let changed = false
                const messages = state.messages.map((message) => {
                  const snapshot = snapshotsByMessageId.get(message.id)
                  if (!snapshot) return message
                  const nextMessage = applyMessageReactionSnapshot(
                    message,
                    snapshot
                  )
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
            } catch (error) {
              for (const messageId of batch) {
                reactionSnapshotMinimumVersionsRef.current.delete(
                  `${conversationId}:${messageId}`
                )
              }
              throw error
            } finally {
              for (const messageId of batch) {
                refreshingReactionSnapshotKeysRef.current.delete(
                  `${conversationId}:${messageId}`
                )
              }
            }

            const versionsByMessageId = new Map(
              snapshots.map((snapshot) => [
                snapshot.messageId,
                snapshot.reactionVersion,
              ])
            )
            batch = batch.filter((messageId) => {
              const key = `${conversationId}:${messageId}`
              const minimumVersion =
                reactionSnapshotMinimumVersionsRef.current.get(key) ?? 0
              if ((versionsByMessageId.get(messageId) ?? -1) < minimumVersion) {
                return true
              }
              reactionSnapshotMinimumVersionsRef.current.delete(key)
              return false
            })
          }
          for (const messageId of batch) {
            reactionSnapshotMinimumVersionsRef.current.delete(
              `${conversationId}:${messageId}`
            )
          }
        })
      )
    },
    []
  )

  const handleIncomingConversationMessage = useCallback(
    (
      message: ClientMessage,
      options: { activeConversationId?: string; visible?: boolean } = {}
    ) => {
      const fromCurrentUser =
        currentUserId !== "" &&
        isClientMessageInitiatedByUser(message, currentUserId)
      const messageState =
        conversationMessageStatesRef.current[message.conversationId]
      const visibleInActiveConversation =
        messageState?.viewMode !== "history" &&
        Boolean(options.visible) &&
        options.activeConversationId === message.conversationId
      const activeConversation =
        options.activeConversationId === message.conversationId
      const shouldCacheMessage =
        activeConversation || messageState?.loaded || messageState?.loading

      if (shouldCacheMessage) {
        mergeIncomingConversationMessage(message, { updateList: false })
      } else {
        updateTopicSourcePreview(message)
      }
      saveLatestCachedMessage(message)
      applyConversationMessageToList(message, {
        countUnread: !fromCurrentUser && !visibleInActiveConversation,
      })
    },
    [
      applyConversationMessageToList,
      currentUserId,
      mergeIncomingConversationMessage,
      saveLatestCachedMessage,
      updateTopicSourcePreview,
    ]
  )

  const handleIncomingConversationMessageUpdate = useCallback(
    (message: ClientMessage) => {
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
      updateTopicSourcePreview(message)
    },
    [updateTopicSourcePreview]
  )

  const handleIncomingMessageReactionsUpdate = useCallback(
    (event: MessageReactionsUpdatedEvent) => {
      const state = conversationMessageStatesRef.current[event.conversationId]
      const message = state?.messages.find(
        (candidate) => candidate.id === event.messageId
      )
      if (!message || message.reactionVersion >= event.reactionVersion) {
        return
      }
      if (event.reactionVersion > message.reactionVersion + 1) {
        const key = `${event.conversationId}:${event.messageId}`
        const previousMinimum =
          reactionSnapshotMinimumVersionsRef.current.get(key) ?? 0
        reactionSnapshotMinimumVersionsRef.current.set(
          key,
          Math.max(previousMinimum, event.reactionVersion)
        )
        void refreshMessageReactions(event.conversationId, [
          event.messageId,
        ]).catch(() => undefined)
        return
      }
      setConversationMessageStates((currentStates) => {
        const state = currentStates[event.conversationId]
        if (!state) {
          return currentStates
        }
        const messageIndex = state.messages.findIndex(
          (message) => message.id === event.messageId
        )
        if (
          messageIndex < 0 ||
          (state.messages[messageIndex].reactionVersion ?? 0) >=
            event.reactionVersion
        ) {
          return currentStates
        }
        const messages = [...state.messages]
        messages[messageIndex] = applyMessageReactionsUpdate(
          messages[messageIndex],
          event,
          currentUserId
        )
        return {
          ...currentStates,
          [event.conversationId]: { ...state, messages },
        }
      })
    },
    [currentUserId, refreshMessageReactions]
  )

  const applyChoiceSnapshots = useCallback(
    (snapshots: MessageChoiceSnapshot[]) => {
      if (snapshots.length === 0) {
        return
      }
      const snapshotsByMessageId = new Map(
        snapshots.map((snapshot) => [snapshot.messageId, snapshot])
      )
      setConversationMessageStates((currentStates) => {
        let statesChanged = false
        const nextStates = { ...currentStates }
        for (const [conversationId, state] of Object.entries(currentStates)) {
          let messagesChanged = false
          const messages = state.messages
            .map((message) => {
              const snapshot = snapshotsByMessageId.get(message.id)
              if (!snapshot || snapshot.conversationId !== conversationId) {
                return message
              }
              const nextMessage = applyMessageChoiceSnapshot(message, snapshot)
              if (nextMessage !== message) {
                messagesChanged = true
              }
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
    },
    []
  )

  const handleIncomingMessageChoiceUpdate = useCallback(
    (event: MessageChoiceUpdatedEvent) => {
      setConversationMessageStates((currentStates) => {
        const state = currentStates[event.conversationId]
        if (!state) {
          return currentStates
        }
        const messageIndex = state.messages.findIndex(
          (message) => message.id === event.messageId
        )
        if (messageIndex < 0) {
          return currentStates
        }
        const previousMessage = state.messages[messageIndex]
        const choice = {
          ...event.choice,
          myOptionIds:
            event.actorUserId === currentUserId
              ? event.actorOptionIds
              : (previousMessage.choice?.myOptionIds ?? []),
        }
        const nextMessage = applyMessageChoiceState(previousMessage, choice)
        if (nextMessage === previousMessage) {
          return currentStates
        }
        const messages = [...state.messages]
        messages[messageIndex] = nextMessage
        return {
          ...currentStates,
          [event.conversationId]: { ...state, messages },
        }
      })
    },
    [currentUserId]
  )

  const respondToChoice = useCallback(
    async (conversationId: string, messageId: string, optionIds: string[]) => {
      try {
        const result = await submitConversationMessageChoiceResponse(
          conversationId,
          messageId,
          optionIds
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
    [applyChoiceSnapshots, handleError]
  )

  const setMessageReaction = useCallback(
    async (
      conversationId: string,
      messageId: string,
      text: string,
      reacted: boolean
    ) => {
      const result = await setConversationMessageReactionRequest(
        conversationId,
        messageId,
        { reacted, text }
      )
      setConversationMessageStates((currentStates) => {
        const state = currentStates[result.conversationId]
        if (!state) {
          return currentStates
        }
        const messageIndex = state.messages.findIndex(
          (message) => message.id === result.messageId
        )
        if (messageIndex < 0) {
          return currentStates
        }
        const messages = [...state.messages]
        messages[messageIndex] = applyMessageReactionSnapshot(
          messages[messageIndex],
          result
        )
        if (messages[messageIndex] === state.messages[messageIndex]) {
          return currentStates
        }
        return {
          ...currentStates,
          [result.conversationId]: { ...state, messages },
        }
      })
      return result
    },
    []
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
                lastMentionedSeq: Math.max(
                  conversation.lastMentionedSeq,
                  lastMentionedSeq
                ),
              }
            : conversation
        )
      )
    },
    []
  )

  const updateConversationLastChoiceSeq = useCallback(
    (conversationId: string, lastChoiceSeq: number) => {
      if (!conversationId || lastChoiceSeq <= 0) {
        return
      }

      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                lastChoiceSeq: Math.max(
                  conversation.lastChoiceSeq,
                  lastChoiceSeq
                ),
              }
            : conversation
        )
      )
    },
    []
  )

  const updateConversationPinned = useCallback(
    (conversationId: string, pinned: boolean) => {
      if (!conversationId) {
        return
      }
      setConversations((currentConversations) =>
        orderConversations(
          currentConversations.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, pinned }
              : conversation
          )
        )
      )
    },
    []
  )

  const setConversationPinned = useCallback(
    async (conversationId: string, pinned: boolean) => {
      try {
        const result = await setConversationPinnedRequest(
          conversationId,
          pinned
        )
        updateConversationPinned(result.conversationId, result.pinned)
      } catch (error) {
        throw handleError(error, pinned ? "置顶会话失败" : "取消置顶失败")
      }
    },
    [handleError, updateConversationPinned]
  )

  const updateConversationMuted = useCallback(
    (conversationId: string, muted: boolean) => {
      if (!conversationId) {
        return
      }
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, notificationMuted: muted }
            : conversation
        )
      )
    },
    []
  )

  const setConversationMuted = useCallback(
    async (conversationId: string, muted: boolean) => {
      try {
        const result = await setConversationMutedRequest(conversationId, muted)
        updateConversationMuted(result.conversationId, result.muted)
      } catch (error) {
        throw handleError(
          error,
          muted ? "开启消息免打扰失败" : "取消消息免打扰失败"
        )
      }
    },
    [handleError, updateConversationMuted]
  )

  const updateMessageTopic = useCallback(
    (
      parentConversationId: string,
      sourceMessageId: string,
      topic: Pick<ClientMessageTopic, "archived" | "conversationId">
    ) => {
      setConversations((currentConversations) =>
        topic.archived
          ? currentConversations.filter(
              (conversation) => conversation.id !== topic.conversationId
            )
          : currentConversations.map((conversation) =>
              conversation.id === topic.conversationId && conversation.topic
                ? {
                    ...conversation,
                    topic: { ...conversation.topic, archived: false },
                  }
                : conversation
            )
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
    []
  )

  const markConversationRead = useCallback(
    async (
      conversationId: string,
      options: MarkConversationReadOptions = {}
    ) => {
      if (!conversationId) {
        return
      }

      try {
        const result = await markConversationReadRequest(
          conversationId,
          options
        )
        setConversations((currentConversations) =>
          currentConversations.map((conversation) =>
            conversation.id === result.conversationId
              ? {
                  ...conversation,
                  lastReadSeq: result.lastReadSeq,
                  unreadCount: result.unreadCount,
                }
              : conversation
          )
        )
      } catch (error) {
        throw handleError(error, "标记会话已读失败")
      }
    },
    [handleError]
  )

  const syncLoadedConversationMessages = useCallback(() => {
    for (const [conversationId, state] of Object.entries(
      conversationMessageStatesRef.current
    )) {
      if (!state.loaded) {
        continue
      }

      const newestSeq = getNewestMessageSeq(state)
      if (newestSeq > 0) {
        syncAfterConversationMessages(conversationId, newestSeq)
      }
      void refreshMessageReactions(
        conversationId,
        state.messages.map((message) => message.id)
      ).catch(() => undefined)
      const choiceMessageIds = state.messages
        .filter((message) => message.body.type === "choice")
        .map((message) => message.id)
      for (
        let index = 0;
        index < choiceMessageIds.length;
        index += choiceSnapshotBatchSize
      ) {
        void listConversationMessageChoiceSnapshots(
          conversationId,
          choiceMessageIds.slice(index, index + choiceSnapshotBatchSize)
        )
          .then(applyChoiceSnapshots)
          .catch(() => undefined)
      }
    }
  }, [
    applyChoiceSnapshots,
    refreshMessageReactions,
    syncAfterConversationMessages,
  ])

  const getConversationAccountGeneration = useCallback(
    () => conversationAccountGenerationRef.current,
    []
  )

  const {
    sendConversationFile,
    sendConversationImage,
    sendConversationLink,
    sendConversationMarkdown,
    sendConversationCard,
    sendConversationText,
    sendConversationVoice,
  } = useConversationSenders({
    currentUserId: me?.id ?? "",
    conversationMessageStatesRef,
    getConversationAccountGeneration,
    mergeIncomingConversationMessage,
    updateConversationMessageState,
  })

  const {
    addGroupConversationMembers,
    createGroupConversation,
    dissolveGroupConversation,
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
    refreshContacts,
    setConversationMessageStates,
    setConversations,
    onConversationRemoved: (conversationId) => {
      const conversation = conversationsRef.current.find(
        (item) => item.id === conversationId
      )
      if (conversation) {
        removedConversationsRef.current.set(conversationId, conversation)
      }
      removedConversationIdsRef.current.add(conversationId)
    },
    onConversationUpserted: (conversationId) => {
      removedConversationIdsRef.current.delete(conversationId)
      removedConversationsRef.current.delete(conversationId)
    },
  })

  const dismissConversation = useCallback(
    async (conversationId: string) => {
      try {
        const result = await dismissConversationRequest(conversationId)
        removeConversation(result.conversationId)
      } catch (error) {
        throw handleError(error, "删除对话失败")
      }
    },
    [handleError, removeConversation]
  )

  const bootstrap = useCallback(async () => {
    const conversationSnapshotSequence =
      ++conversationSnapshotSequenceRef.current
    const generation = ++bootstrapGenerationRef.current
    const isCurrent = () =>
      mountedRef.current && bootstrapGenerationRef.current === generation
    const minimumLoading = wait(minimumBootstrapLoadingMs)

    try {
      const [nextMe, nextContacts, nextConversations, nextProjects] =
        await Promise.all([
          getCurrentClientUser(),
          listClientContacts(),
          shouldLoadConversations
            ? listClientConversations(undefined, {
                includeConversationId: includedConversationIdRef.current,
              })
            : Promise.resolve([]),
          listClientProjects({ limit: 100 }),
        ])

      const preloadedMessageStates: Record<
        string,
        ClientConversationMessageState
      > = {}
      const preloadedLatestMessages: Record<string, ClientMessage> = {}
      const conversationsToPreload = orderConversations(
        nextConversations
      ).slice(0, bootstrapConversationLimit)
      let nextConversationIndex = 0
      let acceptingPreloadResults = true
      const preloadWorker = async () => {
        while (nextConversationIndex < conversationsToPreload.length) {
          const conversation = conversationsToPreload[nextConversationIndex++]
          try {
            const result = await listConversationMessages(conversation.id, {
              limit: bootstrapMessageLimit,
            })
            if (!isCurrent() || !acceptingPreloadResults) return
            preloadedMessageStates[conversation.id] = {
              ...createConversationMessageState(),
              loaded: true,
              latestKnownSeq: result.page.newestSeq,
              messages: result.messages,
              page: result.page,
            }
            const latestMessage = result.messages.at(-1)
            if (latestMessage) {
              preloadedLatestMessages[conversation.id] = latestMessage
            }
          } catch {
            // Leave failures absent so opening the conversation retries normally.
          }
        }
      }
      const preloadTasks = Promise.all(
        Array.from(
          {
            length: Math.min(
              bootstrapMessageConcurrency,
              conversationsToPreload.length
            ),
          },
          () => preloadWorker()
        )
      )
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        preloadTasks,
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, bootstrapMessageTimeoutMs)
        }),
      ])
      acceptingPreloadResults = false
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (!isCurrent()) return

      await ensureUsers(nextContacts.userIds)
      if (nextContacts.directoryMode === "friends") {
        await refreshFriendRequests()
      }
      await minimumLoading
      if (!isCurrent()) return
      setMe(nextMe)
      cacheUserProfiles([
        {
          avatar: nextMe.avatar,
          email: nextMe.email,
          id: nextMe.id,
          lastOnlineAt: nextMe.lastOnlineAt,
          name: nextMe.name,
          nickname: nextMe.nickname,
          online: true,
          phone: nextMe.phone,
          type: "user",
        },
      ])
      setContactApps(nextContacts.apps)
      setContactDirectoryMode(nextContacts.directoryMode)
      setContactGroups(nextContacts.groups)
      setContactUserIds(nextContacts.userIds)
      const accountChanged = shouldReplaceConversationSnapshot(
        conversationAccountIdRef.current,
        nextMe.id
      )
      if (accountChanged) {
        conversationAccountIdRef.current = nextMe.id
        conversationAccountGenerationRef.current += 1
        invalidateConversationMessageRequests()
        clearConversationRemovalState(
          removedConversationIdsRef.current,
          removedConversationsRef.current
        )
        ++conversationSnapshotSequenceRef.current
        setConversations(orderConversations(nextConversations))
      } else if (
        isLatestConversationSnapshot(
          conversationSnapshotSequence,
          conversationSnapshotSequenceRef.current
        )
      ) {
        setConversations((current) =>
          mergeConversationSnapshot(
            current,
            nextConversations,
            removedConversationIdsRef.current
          )
        )
      }
      setConversationMessageStates((currentStates) =>
        mergeBootstrapConversationMessageStates(
          currentStates,
          preloadedMessageStates,
          accountChanged
        )
      )
      setLatestCachedMessages((currentMessages) =>
        accountChanged
          ? preloadedLatestMessages
          : mergeLatestCachedMessages(
              currentMessages,
              preloadedLatestMessages
            )
      )
      setPersonalProject(nextProjects.personalProject)
      setProjects(nextProjects.projects)
      setProjectsNextCursor(nextProjects.nextCursor)
      setBootstrapState("ready")
    } catch (error) {
      if (!isCurrent()) return
      const requestError = handleError(error, "加载工作区失败")

      if (requestError.status !== 401 && requestError.code !== "unauthorized") {
        await minimumLoading
      }

      if (!isCurrent()) return
      setBootstrapError(requestError)
      setBootstrapState("error")
    } finally {
      if (isCurrent()) {
        setMeLoading(false)
        setContactsLoading(false)
        setProjectsLoading(false)
      }
    }
  }, [
    cacheUserProfiles,
    ensureUsers,
    handleError,
    invalidateConversationMessageRequests,
    refreshFriendRequests,
    shouldLoadConversations,
  ])

  const retryBootstrap = useCallback(async () => {
    setBootstrapError(null)
    setBootstrapState("loading")
    setConversations([])
    setConversationMessageStates({})
    setLatestCachedMessages({})
    setContactApps([])
    setContactDirectoryMode("organization")
    setContactGroups([])
    setIncomingFriendRequests([])
    setOutgoingFriendRequests([])
    setContactUserIds([])
    setContactsError(null)
    setContactsLoading(true)
    setContactsRefreshing(false)
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

    function refresh() {
      void refreshMe().catch(() => undefined)
      void refreshContacts().catch(() => undefined)
      if (shouldLoadConversations) {
        void refreshConversations().catch(() => undefined)
      }
      void refreshProjects().catch(() => undefined)
    }

    const interval = window.setInterval(refresh, refreshIntervalMs)

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refresh()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [
    bootstrapState,
    refreshContacts,
    refreshConversations,
    refreshRestoredConversation,
    refreshMe,
    refreshProjects,
    shouldLoadConversations,
  ])

  const getVisibleConversation = useCallback(
    (conversationId: string) =>
      visibleConversations.find(
        (conversation) => conversation.id === conversationId
      ) ?? null,
    [visibleConversations]
  )

  const getVisibleConversationMessageState = useCallback(
    (conversationId: string) =>
      visibleConversationMessageStates[conversationId] ??
      getConversationMessageState(conversationId),
    [getConversationMessageState, visibleConversationMessageStates]
  )

  if (bootstrapState === "loading") {
    return <ClientLoadingPage />
  }

  if (bootstrapState === "error") {
    return (
      <ClientDataErrorPage
        message={bootstrapError?.message ?? "加载工作区失败"}
        onRetry={() => void retryBootstrap()}
      />
    )
  }

  if (!me || !personalProject) {
    return <ClientLoadingPage />
  }

  const value: ClientDataContextValue = {
    acceptFriendRequest,
    addGroupConversationMembers,
    cancelFriendRequest,
    contactApps,
    contactDirectoryMode,
    contactGroups: visibleContactGroups,
    compactConversationMessages,
    consumeConversationMessageFocus,
    conversations: visibleConversations,
    contacts,
    contactsError,
    contactsLoading,
    contactsRefreshing,
    createFriendRequest,
    createGroupConversation,
    createProject,
    dissolveGroupConversation,
    dismissConversation,
    deleteFriend,
    ensureConversationMessages,
    ensureUsers,
    focusConversationMessage,
    foregroundConversationId,
    getConversation: getVisibleConversation,
    getConversationMessageState: getVisibleConversationMessageState,
    getLatestCachedMessage,
    getUser,
    incomingFriendRequests,
    invalidateUsers,
    joinGroupConversation,
    leaveGroupConversation,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
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
    outgoingFriendRequests,
    personalProject,
    projects,
    projectsError,
    projectsLoading,
    projectsLoadingMore,
    projectsNextCursor,
    projectsRefreshing,
    registerConversationMessageView,
    respondToChoice,
    refreshConversations,
    refreshRestoredConversation,
    refreshContacts,
    refreshFriendRequests,
    refreshMe,
    refreshProjects,
    loadMoreProjects,
    removeConversation,
    restoreConversation,
    removeGroupConversationMember,
    rejectFriendRequest,
    returnToLatestConversationMessages,
    revokeConversationMessage,
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
    updateUserPresence,
    usersById,
  }

  return (
    <ClientDataContext.Provider value={value}>
      <ClientProfileProvider
        acceptFriendRequest={acceptFriendRequest}
        contactApps={contactApps}
        contactDirectoryMode={contactDirectoryMode}
        contacts={contacts}
        createFriendRequest={createFriendRequest}
        incomingFriendRequests={incomingFriendRequests}
        me={me}
        openAppConversation={openAppConversation}
        openDirectConversation={openDirectConversation}
        outgoingFriendRequests={outgoingFriendRequests}
        usersById={usersById}
      >
        {children}
      </ClientProfileProvider>
    </ClientDataContext.Provider>
  )
}

function hydrateContactGroupUsers(
  groups: ContactGroup[],
  apps: ContactApp[],
  usersById: Readonly<Record<string, ContactUser>>
) {
  const appsById = Object.fromEntries(apps.map((app) => [app.id, app]))
  return groups.map((group) => ({
    ...group,
    avatarMembers: group.avatarMembers.map((member) => {
      const profile = conversationIdentityProfile(
        member.type,
        member.id,
        usersById,
        appsById
      )
      return profile
        ? {
            ...member,
            avatar: profile.avatar,
            name: profile.name,
            nickname: profile.nickname,
          }
        : member
    }),
  }))
}

function messageUserIDs(message: ClientMessage) {
  const ids = new Set<string>()
  if (message.sender.type === "user") ids.add(message.sender.id)
  if (message.replyTo?.sender.type === "user")
    ids.add(message.replyTo.sender.id)
  for (const reaction of message.reactions) {
    for (const user of reaction.users) ids.add(user.id)
  }
  for (const reply of message.topic?.recentReplies ?? []) {
    if (reply.sender.type === "user") ids.add(reply.sender.id)
  }
  return Array.from(ids)
}

function hydrateMessageUsers(
  message: ClientMessage,
  usersById: Readonly<Record<string, ContactUser>>
) {
  let changed = false
  const reactions = message.reactions.map((reaction) => {
    let usersChanged = false
    const users = reaction.users.map((user) => {
      const profile = usersById[user.id]
      const name = profile?.nickname || profile?.name
      if (!name || name === user.name) return user
      usersChanged = true
      return { ...user, name }
    })
    changed ||= usersChanged
    return usersChanged ? { ...reaction, users } : reaction
  })
  let replyTo = message.replyTo
  if (replyTo?.sender.type === "user") {
    const profile = usersById[replyTo.sender.id]
    const name = profile?.nickname || profile?.name
    if (name && name !== replyTo.sender.name) {
      changed = true
      replyTo = {
        ...replyTo,
        sender: { ...replyTo.sender, name },
      }
    }
  }
  return changed ? { ...message, reactions, replyTo } : message
}

function conversationUserIDs(conversation: ClientConversation) {
  const ids = new Set<string>()
  for (const member of conversation.members ?? []) {
    if (member.type === "user" && member.id) ids.add(member.id)
  }
  if (conversation.lastMessageSender?.type === "user") {
    ids.add(conversation.lastMessageSender.id)
  }
  if (conversation.topic?.sourceSender.type === "user") {
    ids.add(conversation.topic.sourceSender.id)
  }
  return Array.from(ids)
}

function hydrateConversationUsers(
  conversation: ClientConversation,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: Readonly<Record<string, ContactApp>>
) {
  let changed = false
  const members = conversation.members?.map((member) => {
    const profile = conversationIdentityProfile(
      member.type,
      member.id,
      usersById,
      appsById
    )
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
      appsById
    )
    const nickname = profile?.nickname ?? ""
    if (
      profile &&
      (lastMessageSender.name !== profile.name ||
        lastMessageSender.nickname !== nickname)
    ) {
      changed = true
      lastMessageSender = {
        ...lastMessageSender,
        name: profile.name,
        nickname,
      }
    }
  }
  let topic = conversation.topic
  if (topic) {
    const sender = topic.sourceSender
    const profile =
      sender.type === "user" ? usersById[sender.id] : appsById[sender.id]
    if (
      profile &&
      (sender.avatar !== profile.avatar || sender.name !== profile.name)
    ) {
      changed = true
      topic = {
        ...topic,
        sourceSender: {
          ...sender,
          avatar: profile.avatar,
          name: profile.name,
        },
      }
    }
  }
  return changed
    ? { ...conversation, lastMessageSender, members, topic }
    : conversation
}

function conversationIdentityProfile(
  type: "app" | "system" | "user",
  id: string,
  usersById: Readonly<Record<string, ContactUser>>,
  appsById: Readonly<Record<string, ContactApp>>
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
      ? {
          avatar: app.avatar,
          email: "",
          name: app.name,
          nickname: "",
          phone: "",
        }
      : undefined
  }
  return undefined
}

function compareUserVersions(left: string, right: string) {
  const leftMatch = left.match(/^(.*?)(?:\.(\d+))?Z$/)
  const rightMatch = right.match(/^(.*?)(?:\.(\d+))?Z$/)
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
    const leftFraction = (leftMatch[2] ?? "").padEnd(9, "0").slice(0, 9)
    const rightFraction = (rightMatch[2] ?? "").padEnd(9, "0").slice(0, 9)
    return leftFraction.localeCompare(rightFraction)
  }
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime
  }
  return left.localeCompare(right)
}

function getConversationLastMessageSender(
  conversation: ClientConversation,
  message: ClientMessage
): ClientConversation["lastMessageSender"] {
  if (message.sender.type === "system") {
    return { id: "", name: "系统", nickname: "", type: "system" }
  }

  const member = conversation.members?.find(
    (candidate) =>
      candidate.type === message.sender.type &&
      candidate.id === message.sender.id
  )
  return {
    id: message.sender.id,
    name: member?.name ?? "",
    nickname: member?.nickname ?? "",
    type: message.sender.type,
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function ClientDataErrorPage({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-svh items-center justify-center bg-background px-4 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-base font-medium">工作区加载失败</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry} type="button" variant="outline">
          重试
        </Button>
      </div>
    </div>
  )
}
