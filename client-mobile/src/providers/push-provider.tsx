import * as Notifications from "expo-notifications"
import { useRouter, type Href } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { AppState, Platform } from "react-native"

import { ApiRequestError } from "@/data/api-client"
import {
  addJPushNotificationResponseListener,
  clearLastJPushNotificationResponse,
  getLastJPushNotificationResponse,
} from "@/notifications/jpush-registration"
import { PushNotificationCoordinator } from "@/notifications/push-notification-coordinator"
import { resolvePrivatePushRoute } from "@/notifications/push-private-server-api"
import {
  consumePendingPushRoute,
  enqueuePendingPushRoute,
  loadPendingPushRoutes,
  loadPushDelegation,
  replacePendingPushRoutes,
} from "@/notifications/push-registration-store"
import {
  getPushRetryDelay,
  type PendingPushRoute,
} from "@/notifications/push-types"
import { usePushReminder } from "@/notifications/use-push-reminder"
import { useAuth } from "@/providers/auth-provider"
import { isCurrentPushIdentity, setCurrentPushIdentity } from "@/notifications/push-runtime-state"
import { usePushCoordinator } from "@/providers/push-coordinator-provider"
import { useClientDataStatus } from "@/providers/client-data-provider"
import { useRealtime } from "@/realtime/realtime-context"

export function PushProvider({ children }: React.PropsWithChildren) {
  usePushReminder()
  const router = useRouter()
  const { active, isAuthenticated, isHydrated, isSigningOut } = useAuth()
  const pushCoordinator = usePushCoordinator()
  const { isMessageBootstrapComplete } = useClientDataStatus()
  const { ready: realtimeReady } = useRealtime()
  const [notificationCoordinator] = useState(
    () =>
      new PushNotificationCoordinator({
        clearLastResponse: clearLastNotificationResponse,
        consumeRoute: consumePendingPushRoute,
        enqueueRoute: enqueuePendingPushRoute,
        isMissingRouteError: (error) =>
          error instanceof ApiRequestError && error.status === 404,
        loadDelegation: loadPushDelegation,
        loadRoutes: loadPendingPushRoutes,
        replaceRoutes: replacePendingPushRoutes,
        resolveRoute: resolvePrivatePushRoute,
      })
  )
  const identity = useMemo(
    () =>
      active
        ? {
            accountId: active.accountId,
            generation: active.generation,
            target: active.target,
          }
        : null,
    [active]
  )
  const routeRetryCountRef = useRef(0)
  const [routeAttempt, setRouteAttempt] = useState(0)

  useEffect(() => {
    if (Platform.OS === "web") return
    const currentIdentity = isAuthenticated ? identity : null
    setCurrentPushIdentity(currentIdentity)
    const changed = pushCoordinator.configure({
      enabled: isHydrated && !isSigningOut,
      identity: currentIdentity,
    })
    if (!changed && realtimeReady) pushCoordinator.triggerSynchronization()
    return () => {
      if (currentIdentity && isCurrentPushIdentity(currentIdentity)) setCurrentPushIdentity(null)
    }
  }, [
    isAuthenticated,
    isHydrated,
    isSigningOut,
    pushCoordinator,
    realtimeReady,
    identity,
  ])

  useEffect(() => {
    if (
      (Platform.OS !== "ios" && Platform.OS !== "android") ||
      !isAuthenticated ||
      isSigningOut ||
      !identity ||
      !isMessageBootstrapComplete
    ) {
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    void notificationCoordinator
      .openPendingRoute({
        navigate: (route, pending) =>
          router.push(buildPushConversationHref(route, pending)),
        identity,
        isCurrent: isCurrentPushIdentity,
      })
      .then((hasMore) => {
        routeRetryCountRef.current = 0
        if (hasMore) setRouteAttempt((current) => current + 1)
      })
      .catch(() => {
        if (cancelled) return
        const delay = getPushRetryDelay(routeRetryCountRef.current)
        routeRetryCountRef.current += 1
        retryTimer = setTimeout(
          () => setRouteAttempt((current) => current + 1),
          delay
        )
      })
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [
    isAuthenticated,
    isMessageBootstrapComplete,
    isSigningOut,
    routeAttempt,
    notificationCoordinator,
    router,
    identity,
  ])

  useEffect(() => {
    if (Platform.OS === "web") return
    const currentIdentity = isAuthenticated && !isSigningOut ? identity : null
    const appStateSubscription = AppState.addEventListener(
      "change",
      (status) => {
        if (status !== "active") return
        pushCoordinator.triggerSynchronization()
        if (currentIdentity && isCurrentPushIdentity(currentIdentity)) setRouteAttempt((current) => current + 1)
      }
    )
    const pushTokenSubscription =
      Platform.OS === "ios"
        ? Notifications.addPushTokenListener((token) => {
            if (
              currentIdentity &&
              isCurrentPushIdentity(currentIdentity) &&
              token.type === "ios" &&
              typeof token.data === "string"
            ) {
              pushCoordinator.triggerSynchronization(token.data)
            }
          })
        : null
    return () => {
      appStateSubscription.remove()
      pushTokenSubscription?.remove()
    }
  }, [identity, isAuthenticated, isSigningOut, pushCoordinator])

  useEffect(() => {
    if (Platform.OS === "web") return
    const currentIdentity = isAuthenticated && !isSigningOut ? identity : null
    const processResponse = (response: {
      data: unknown
      date: number
      identifier: string
    }) => {
      void notificationCoordinator
        .handleResponse({
          navigateLocal: (conversationId) =>
            router.push(buildLocalConversationHref(conversationId)),
          response,
          identity: currentIdentity,
          isCurrent: isCurrentPushIdentity,
        })
        .then((hasPendingRoute) => {
          if (hasPendingRoute) {
            setRouteAttempt((current) => current + 1)
          }
        })
        .catch(() => undefined)
    }
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        processResponse({
          data: response.notification.request.content.data,
          date: response.notification.date,
          identifier: response.notification.request.identifier.trim(),
        })
      })
    const jpushResponseSubscription =
      addJPushNotificationResponseListener(processResponse)
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return
        processResponse({
          data: response.notification.request.content.data,
          date: response.notification.date,
          identifier: response.notification.request.identifier.trim(),
        })
      })
      .catch(() => undefined)
    void getLastJPushNotificationResponse()
      .then((response) => {
        if (response) processResponse(response)
      })
      .catch(() => undefined)
    return () => {
      responseSubscription.remove()
      jpushResponseSubscription?.remove()
    }
  }, [
    isAuthenticated,
    isSigningOut,
    notificationCoordinator,
    router,
    identity,
  ])

  return children
}

function clearLastNotificationResponse() {
  void clearLastJPushNotificationResponse().catch(() => undefined)
  try {
    Notifications.clearLastNotificationResponse()
  } catch {
    // Older native runtimes may not expose the synchronous clear method.
  }
}

function buildLocalConversationHref(conversationId: string): Href {
  return {
    params: { conversationId },
    pathname: "/(app)/conversation/[conversationId]",
  }
}

function buildPushConversationHref(
  route: { conversationId: string; messageId: string },
  pending: PendingPushRoute
): Href {
  return {
    params: {
      conversationId: route.conversationId,
      messageId: route.messageId,
      pushGrantId: pending.grantId,
    },
    pathname: "/(app)/conversation/[conversationId]",
  } as Href
}
