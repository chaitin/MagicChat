import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, Platform, type AppStateStatus } from "react-native"

import { isUnauthorizedError } from "@/data/api-client"
import { fetchCurrentUser } from "@/data/current-user-api"
import type { AuthenticatedTarget } from "@/data/query"
import { useAuth } from "@/features/auth/auth-context"
import {
  prepareMessageNotifications,
  showBackgroundMessageNotification,
} from "@/notifications/message-notifications"
import {
  applyRealtimeEvent,
  refreshClientDataOnForeground,
  synchronizeRealtimeData,
} from "@/realtime/realtime-cache"
import {
  buildRealtimeWebSocketUrl,
  RealtimeClient,
  type RealtimeSnapshot,
} from "@/realtime/realtime-client"
import {
  DISCONNECTED_REALTIME_SNAPSHOT,
  RealtimeContext,
} from "@/realtime/realtime-context"
import { realtimeEvents } from "@/realtime/realtime-protocol"

export function RealtimeProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const { invalidateSession, session } = useAuth()
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot>(
    DISCONNECTED_REALTIME_SNAPSHOT
  )
  const activeConversationIdRef = useRef("")
  const activateConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId

    return () => {
      if (activeConversationIdRef.current === conversationId) {
        activeConversationIdRef.current = ""
      }
    }
  }, [])
  const server = useMemo<AuthenticatedTarget | null>(
    () =>
      session
        ? { id: session.id, url: session.url, userId: session.userId }
        : null,
    [session]
  )
  const realtimeEnabled =
    server !== null && canConnectFromCurrentPlatform(server.url)

  useEffect(() => {
    if (!realtimeEnabled || !server) {
      return
    }

    const activeServer = server
    let isActive = true
    let synchronization = Promise.resolve()
    let currentAppState = AppState.currentState
    const client = new RealtimeClient({
      authCheck: async () => {
        try {
          await fetchCurrentUser(activeServer.url)
          return true
        } catch (error: unknown) {
          if (isUnauthorizedError(error)) {
            return false
          }
          throw error
        }
      },
      onUnauthorized: () => {
        void invalidateSession()
      },
      url: buildRealtimeWebSocketUrl(activeServer.url),
    })

    const unsubscribeSnapshot = client.subscribe(() => {
      if (isActive) {
        setSnapshot(client.getSnapshot())
      }
    })
    const unsubscribeEvents = client.subscribeEvent((event, payload) => {
      if (event === realtimeEvents.systemReady) {
        enqueueSynchronization(() =>
          synchronizeRealtimeData(queryClient, activeServer)
        )
        return
      }

      void applyRealtimeEvent(queryClient, activeServer, event, payload, {
        activeConversationId: activeConversationIdRef.current,
        visible: currentAppState === "active",
      })
        .then(({ message }) => {
          if (
            event === realtimeEvents.messageCreated &&
            message &&
            currentAppState !== "active"
          ) {
            void showBackgroundMessageNotification(
              queryClient,
              activeServer,
              message
            ).catch(() => undefined)
          }
        })
        .catch(handleRealtimeDataError)
    })

    function enqueueSynchronization(task: () => Promise<void>) {
      synchronization = synchronization
        .catch(() => undefined)
        .then(task)
        .catch(handleRealtimeDataError)
    }

    function handleRealtimeDataError(error: unknown) {
      if (isActive && isUnauthorizedError(error)) {
        void invalidateSession()
      }
    }

    function handleAppStateChange(status: AppStateStatus) {
      const wasActive = currentAppState === "active"
      currentAppState = status

      if (status === "active" && !wasActive) {
        client.connect()
        void prepareMessageNotifications().catch(() => undefined)
        enqueueSynchronization(() =>
          refreshClientDataOnForeground(queryClient, activeServer)
        )
      }
    }

    const appStateSubscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    )
    client.connect()
    if (currentAppState === "active") {
      void prepareMessageNotifications().catch(() => undefined)
    }

    return () => {
      isActive = false
      activeConversationIdRef.current = ""
      appStateSubscription.remove()
      unsubscribeEvents()
      unsubscribeSnapshot()
      client.disconnect()
    }
  }, [invalidateSession, queryClient, realtimeEnabled, server])

  const value = useMemo(() => {
    if (!realtimeEnabled) {
      return {
        ...DISCONNECTED_REALTIME_SNAPSHOT,
        activateConversation,
      }
    }

    return {
      activateConversation,
      ready: snapshot.ready,
      status: snapshot.status,
    }
  }, [activateConversation, realtimeEnabled, snapshot.ready, snapshot.status])

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}

function canConnectFromCurrentPlatform(serverUrl: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return true
  }

  // Browsers control the Origin header and the current server only permits
  // same-origin websocket upgrades. Native Android/iOS connections are not
  // subject to this browser restriction.
  try {
    return new URL(serverUrl).origin === window.location.origin
  } catch {
    return false
  }
}
