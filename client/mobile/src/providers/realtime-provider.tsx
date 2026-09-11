import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, Platform, type AppStateStatus } from "react-native"

import type { AuthenticatedTarget } from "@/core/server-target"
import { isUnauthorizedError } from "@/data/api-client"
import { accountAuthRuntime } from "@/data/auth/account-runtime-instance"
import { fetchCurrentUser } from "@/data/users/current-user-api"
import { prepareMessageNotifications, showBackgroundMessageNotification } from "@/notifications/message-notifications"
import { hasActiveRemotePushDelegation } from "@/notifications/push-runtime-state"
import { useAuth } from "@/providers/auth-provider"
import { applyRealtimeEvent, refreshClientDataOnForeground, synchronizeRealtimeData } from "@/realtime/realtime-cache"
import { buildRealtimeWebSocketUrl, RealtimeClient, type RealtimeSnapshot, type RealtimeSocketFactory } from "@/realtime/realtime-client"
import { createRealtimeTargetKey, waitForClientReady, waitForRealtimeClient } from "@/realtime/realtime-connection"
import { DISCONNECTED_REALTIME_SNAPSHOT, RealtimeContext } from "@/realtime/realtime-context"
import { RealtimeDispatcher } from "@/realtime/realtime-dispatcher"
import { realtimeEvents } from "@/realtime/realtime-protocol"
import { RealtimeClientSlot } from "@/realtime/realtime-runtime"

export function RealtimeProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const { active, isPreparingSignIn, markReauthRequired } = useAuth()
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(DISCONNECTED_REALTIME_SNAPSHOT)
  const activeConversationIdRef = useRef("")
  const [dispatcher] = useState(() => new RealtimeDispatcher())
  const [runtimeSlot] = useState(() => new RealtimeClientSlot())
  const clientRef = useRef<{ client: RealtimeClient; targetKey: string } | null>(null)

  const activateConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId
    return () => { if (activeConversationIdRef.current === conversationId) activeConversationIdRef.current = "" }
  }, [])

  const waitUntilReady = useCallback(async (target: AuthenticatedTarget, options: { attempts: number; timeoutMs: number }) => {
    const client = await waitForRealtimeClient(clientRef, createRealtimeTargetKey(target), options.timeoutMs)
    let lastError: unknown
    for (let attempt = 0; attempt < options.attempts; attempt += 1) {
      if (attempt > 0) { client.disconnect(); client.connect() }
      try { await waitForClientReady(client, options.timeoutMs); return }
      catch (error) { lastError = error }
    }
    throw lastError
  }, [])

  const server = active?.target ?? null
  const realtimeEnabled = server !== null && canConnectFromCurrentPlatform(server.url)

  useEffect(() => {
    if (!realtimeEnabled || !server || !active) {
      runtimeSlot.clear()
      clientRef.current = null
      return
    }
    const activeServer = server
    const identity = { accountId: active.accountId, generation: active.generation }
    const auth = accountAuthRuntime.optionsFor(activeServer, active.accountId)
    let isActive = true
    let currentAppState = AppState.currentState
    let client!: RealtimeClient
    client = new RealtimeClient({
      auth: auth.auth,
      isCurrent: auth.isCurrent,
      createSocket: Platform.OS === "web" ? createWebRealtimeSocket : undefined,
      authCheck: async () => {
        try { await fetchCurrentUser(activeServer); return true }
        catch (error) { if (isUnauthorizedError(error)) return false; throw error }
      },
      onUnauthorized: (accountId) => {
        if (accountId === identity.accountId && runtimeSlot.isCurrent(identity, client)) void markReauthRequired(accountId)
      },
      reconnectDelaysMs: isPreparingSignIn ? [30_000] : undefined,
      url: buildRealtimeWebSocketUrl(activeServer.url, __DEV__),
    })
    const record = { client, targetKey: createRealtimeTargetKey(activeServer) }
    runtimeSlot.replace(client, identity)
    clientRef.current = record
    const isCurrent = () => runtimeSlot.isCurrent(identity, client) && accountAuthRuntime.isCurrent(identity)
    const dispatchTarget = dispatcher.activate((error) => {
      if (isUnauthorizedError(error) && isCurrent()) void markReauthRequired(identity.accountId)
    })
    const unsubscribeSnapshot = client.subscribe(() => {
      if (isActive && isCurrent()) setSnapshot(client.getSnapshot())
    })
    const unsubscribeEvents = client.subscribeEvent((event, payload) => {
      if (!isCurrent()) return
      if (event === realtimeEvents.systemReady) {
        if (!isPreparingSignIn) dispatchTarget.enqueue(() => {
          if (!isCurrent()) return Promise.resolve()
          return synchronizeRealtimeData(queryClient, activeServer, { activeConversationId: activeConversationIdRef.current })
        })
        return
      }
      dispatchTarget.enqueue(async () => {
        if (!isCurrent()) return
        const result = (await applyRealtimeEvent(queryClient, activeServer, event, payload, {
          activeConversationId: activeConversationIdRef.current,
          visible: currentAppState === "active",
          isCurrent,
        })) ?? {}
        if (!isCurrent()) return
        const message = "message" in result ? result.message : undefined
        const notificationMuted = "notificationMuted" in result ? result.notificationMuted : undefined
        if (event === realtimeEvents.messageCreated && message && currentAppState !== "active" && !hasActiveRemotePushDelegation({ ...identity, target: activeServer })) {
          void showBackgroundMessageNotification(queryClient, activeServer, message, { notificationMuted, identity: { ...identity, target: activeServer } }).catch(() => undefined)
        }
      })
    })
    function handleAppStateChange(status: AppStateStatus) {
      const wasActive = currentAppState === "active"
      currentAppState = status
      if (status === "active" && !wasActive && isCurrent()) {
        client.connect()
        void prepareMessageNotifications().catch(() => undefined)
        dispatchTarget.enqueue(() => {
          if (!isCurrent()) return Promise.resolve()
          return refreshClientDataOnForeground(queryClient, activeServer, { activeConversationId: activeConversationIdRef.current })
        })
      }
    }
    const appStateSubscription = AppState.addEventListener("change", handleAppStateChange)
    client.connect()
    if (currentAppState === "active") void prepareMessageNotifications().catch(() => undefined)
    return () => {
      isActive = false
      dispatchTarget.dispose()
      runtimeSlot.clear(client)
      if (clientRef.current === record) clientRef.current = null
      activeConversationIdRef.current = ""
      appStateSubscription.remove()
      unsubscribeEvents()
      unsubscribeSnapshot()
    }
  }, [active, dispatcher, isPreparingSignIn, markReauthRequired, queryClient, realtimeEnabled, runtimeSlot, server])

  const value = useMemo(() => realtimeEnabled ? {
    activateConversation, ready: snapshot.ready, status: snapshot.status, waitUntilReady,
  } : { ...DISCONNECTED_REALTIME_SNAPSHOT, activateConversation, waitUntilReady },
  [activateConversation, realtimeEnabled, snapshot.ready, snapshot.status, waitUntilReady])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

const createWebRealtimeSocket: RealtimeSocketFactory = (url, protocols) => new WebSocket(url, protocols)

function canConnectFromCurrentPlatform(serverUrl: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") return true
  try { return new URL(serverUrl).origin === window.location.origin }
  catch { return false }
}
