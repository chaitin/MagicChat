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
import { traceMobileStartup } from "@/diagnostics/mobile-startup"
import { applyRealtimeEvent, createRealtimeSynchronization, refreshClientDataOnForeground } from "@/realtime/realtime-cache"
import { buildRealtimeWebSocketUrl, RealtimeClient, type RealtimeSnapshot, type RealtimeSocketFactory } from "@/realtime/realtime-client"
import { createRealtimeTargetKey, waitForClientReady, waitForRealtimeClient } from "@/realtime/realtime-connection"
import { DISCONNECTED_REALTIME_SNAPSHOT, RealtimeContext } from "@/realtime/realtime-context"
import { RealtimeDispatcher } from "@/realtime/realtime-dispatcher"
import { realtimeEvents } from "@/realtime/realtime-protocol"
import { RealtimeClientSlot } from "@/realtime/realtime-runtime"
import { RealtimeRecovery } from "@/realtime/realtime-recovery"

export function RealtimeProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const { active, isPreparingSignIn, markReauthRequired } = useAuth()
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(DISCONNECTED_REALTIME_SNAPSHOT)
  const [recovery, setRecovery] = useState<{ key: string; recovering: boolean } | null>(null)
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
  const recoveryKey = active ? JSON.stringify([active.accountId, active.generation]) : ""
  const isRecovering = realtimeEnabled && (recovery?.key !== recoveryKey || recovery.recovering)

  useEffect(() => {
    if (realtimeEnabled || !server || !active || isPreparingSignIn) return
    const identity = { accountId: active.accountId, generation: active.generation }
    let current = true
    const isCurrent = () => current && accountAuthRuntime.isCurrent(identity)
    void createRealtimeSynchronization(queryClient, server, {
      freshSnapshot: true,
      getActiveConversationId: () => activeConversationIdRef.current,
      isCurrent,
    })().catch((error) => {
      if (isUnauthorizedError(error) && isCurrent()) void markReauthRequired(identity.accountId)
    })
    return () => { current = false }
  }, [active, isPreparingSignIn, markReauthRequired, queryClient, realtimeEnabled, server])

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
      url: buildRealtimeWebSocketUrl(activeServer.url, __DEV__),
    })
    const record = { client, targetKey: createRealtimeTargetKey(activeServer) }
    runtimeSlot.replace(client, identity)
    clientRef.current = record
    const isCurrent = () => runtimeSlot.isCurrent(identity, client) && accountAuthRuntime.isCurrent(identity)
    const handleError = (error: unknown) => {
      if (isUnauthorizedError(error) && isCurrent()) void markReauthRequired(identity.accountId)
    }
    const dispatchTarget = dispatcher.activate(handleError)
    let synchronization: ReturnType<typeof createRealtimeSynchronization> | undefined
    let connectStartedAt = performance.now()
    const connectionRecovery = new RealtimeRecovery({
      enqueue: dispatchTarget.enqueue,
      isCurrent,
      onChange: (recovering) => {
        if (!isActive || !isCurrent()) return
        if (recovering) synchronization = undefined
        setRecovery((current) => current?.key === recoveryKey && current.recovering === recovering
          ? current : { key: recoveryKey, recovering })
      },
      onError: handleError,
      shouldRetry: (error) => !isUnauthorizedError(error),
      synchronize: () => {
        synchronization ??= createRealtimeSynchronization(queryClient, activeServer, {
          freshSnapshot: true,
          getActiveConversationId: () => activeConversationIdRef.current,
          isCurrent,
        })
        return synchronization()
      },
    })
    const unsubscribeSnapshot = client.subscribe(() => {
      if (!isActive || !isCurrent()) return
      const next = client.getSnapshot()
      if (next.status === "connecting") connectStartedAt = performance.now()
      if (next.ready && connectionRecovery.isRecovering) traceMobileStartup("realtime.transport.ready", { elapsedMs: performance.now() - connectStartedAt })
      setSnapshot(next)
      connectionRecovery.setReady(next.ready && !isPreparingSignIn)
    })
    const unsubscribeEvents = client.subscribeEvent((event, payload) => {
      if (!isCurrent()) return
      if (event === realtimeEvents.systemReady) return
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
        connectionRecovery.retry()
        void prepareMessageNotifications().catch(() => undefined)
        void refreshClientDataOnForeground(queryClient, activeServer, {
          getActiveConversationId: () => activeConversationIdRef.current,
          isCurrent,
          messagesAlreadySynchronizing: connectionRecovery.isRecovering,
        }).catch(handleError)
      }
    }
    const appStateSubscription = AppState.addEventListener("change", handleAppStateChange)
    traceMobileStartup("realtime.connect.start")
    client.connect()
    if (currentAppState === "active") void prepareMessageNotifications().catch(() => undefined)
    return () => {
      isActive = false
      connectionRecovery.dispose()
      dispatchTarget.dispose()
      runtimeSlot.clear(client)
      if (clientRef.current === record) clientRef.current = null
      activeConversationIdRef.current = ""
      appStateSubscription.remove()
      unsubscribeEvents()
      unsubscribeSnapshot()
    }
  }, [active, dispatcher, isPreparingSignIn, markReauthRequired, queryClient, realtimeEnabled, recoveryKey, runtimeSlot, server])

  const value = useMemo(() => realtimeEnabled ? {
    activateConversation, isRecovering, ready: snapshot.ready, status: snapshot.status, waitUntilReady,
  } : { ...DISCONNECTED_REALTIME_SNAPSHOT, activateConversation, waitUntilReady },
  [activateConversation, isRecovering, realtimeEnabled, snapshot.ready, snapshot.status, waitUntilReady])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

const createWebRealtimeSocket: RealtimeSocketFactory = (url, protocols) => new WebSocket(url, protocols)

function canConnectFromCurrentPlatform(serverUrl: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") return true
  try { return new URL(serverUrl).origin === window.location.origin }
  catch { return false }
}
