import type { AuthenticatedTarget } from "@/core/server-target"
import { navigateThenConsumePushRoute } from "@/notifications/push-navigation"
import { SerializedOperationQueue } from "@/notifications/serialized-operation-queue"
import {
  isPendingPushRouteExpired,
  parsePushNotificationData,
  targetsMatch,
  type PendingPushRoute,
  type PushDelegation,
  type PushAccountIdentity,
} from "@/notifications/push-types"

export type PushNotificationResponseData = {
  data: unknown
  date: number
  identifier: string
}

type PushNotificationCoordinatorOperations = {
  clearLastResponse: () => void
  consumeRoute: (route: PendingPushRoute) => Promise<void>
  enqueueRoute: (route: PendingPushRoute) => Promise<void>
  isMissingRouteError: (error: unknown) => boolean
  loadDelegation: () => Promise<PushDelegation | null>
  loadRoutes: () => Promise<PendingPushRoute[]>
  replaceRoutes: (routes: PendingPushRoute[]) => Promise<void>
  resolveRoute: (
    target: AuthenticatedTarget,
    routeToken: string
  ) => Promise<{ conversationId: string; messageId: string }>
}

export class PushNotificationCoordinator {
  private readonly handledResponses = new Set<string>()
  private readonly operations: PushNotificationCoordinatorOperations
  private readonly queue = new SerializedOperationQueue()

  constructor(operations: PushNotificationCoordinatorOperations) {
    this.operations = operations
  }

  handleResponse({
    navigateLocal,
    response,
    identity,
    isCurrent,
  }: {
    navigateLocal: (conversationId: string) => void | Promise<void>
    response: PushNotificationResponseData
    identity: PushAccountIdentity | null
    isCurrent: (identity: PushAccountIdentity) => boolean
  }) {
    return this.queue.run(async () => {
      const remoteData = parsePushNotificationData(response.data)
      if (!remoteData) {
        const localRoute = parseLocalNotificationRoute(response.data)
        if (!localRoute || !identity || !isCurrent(identity) ||
          localRoute.accountId !== identity.accountId ||
          localRoute.generation !== identity.generation ||
          !targetsMatch(localRoute.target, identity.target)) return false
        const responseKey =
          response.identifier ||
          `local:${localRoute.accountId}:${localRoute.conversationId}:${response.date}`
        if (this.handledResponses.has(responseKey)) return false
        this.rememberResponse(responseKey)
        try {
          await navigateLocal(localRoute.conversationId)
          if (!isCurrent(identity)) return false
        } catch (error) {
          this.handledResponses.delete(responseKey)
          throw error
        }
        this.operations.clearLastResponse()
        return false
      }

      if (!identity || !isCurrent(identity)) return false
      const delegation = await this.operations.loadDelegation()
      if (!isCurrent(identity) || !delegation || delegation.accountId !== identity.accountId ||
        delegation.grantId !== remoteData.grantId ||
        !targetsMatch(delegation.target, identity.target)) return false
      const responseKey =
        response.identifier ||
        `remote:${remoteData.grantId}:${remoteData.routeToken}`
      if (this.handledResponses.has(responseKey)) return false
      this.rememberResponse(responseKey)
      const pending = {
        grantId: remoteData.grantId,
        receivedAt: new Date(response.date).toISOString(),
        routeToken: remoteData.routeToken,
      }
      try {
        if (!isCurrent(identity)) return false
        await this.operations.enqueueRoute(pending)
        if (!isCurrent(identity)) {
          await this.operations.consumeRoute(pending)
          return false
        }
      } catch (error) {
        this.handledResponses.delete(responseKey)
        throw error
      }
      this.operations.clearLastResponse()
      return true
    })
  }

  openPendingRoute({
    navigate,
    identity,
    isCurrent,
  }: {
    navigate: (
      route: { conversationId: string; messageId: string },
      pending: PendingPushRoute
    ) => void | Promise<void>
    identity: PushAccountIdentity
    isCurrent: (identity: PushAccountIdentity) => boolean
  }) {
    return this.queue.run(async () => {
      const [storedRoutes, delegation] = await Promise.all([
        this.operations.loadRoutes(),
        this.operations.loadDelegation(),
      ])
      const activeRoutes = storedRoutes.filter(
        (route) => !isPendingPushRouteExpired(route)
      )
      if (activeRoutes.length !== storedRoutes.length) {
        await this.operations.replaceRoutes(activeRoutes)
      }
      if (!isCurrent(identity) || !delegation || delegation.accountId !== identity.accountId || !targetsMatch(delegation.target, identity.target)) return false
      const pending = activeRoutes.find(
        (route) => route.grantId === delegation.grantId
      )
      if (!pending) return false

      let route: { conversationId: string; messageId: string }
      try {
        route = await this.operations.resolveRoute(identity.target, pending.routeToken)
      } catch (error) {
        if (this.operations.isMissingRouteError(error)) {
          await this.operations.consumeRoute(pending)
          return hasAnotherRoute(activeRoutes, pending, delegation.grantId)
        }
        throw error
      }
      if (!isCurrent(identity)) return false
      await navigateThenConsumePushRoute({
        consume: () => this.operations.consumeRoute(pending),
        navigate: () => navigate(route, pending),
      })
      return hasAnotherRoute(activeRoutes, pending, delegation.grantId)
    })
  }

  private rememberResponse(key: string) {
    this.handledResponses.add(key)
    if (this.handledResponses.size <= 128) return
    const oldest = this.handledResponses.values().next().value
    if (typeof oldest === "string") this.handledResponses.delete(oldest)
  }
}

function hasAnotherRoute(
  routes: PendingPushRoute[],
  consumed: PendingPushRoute,
  grantId: string
) {
  return routes.some(
    (candidate) => candidate !== consumed && candidate.grantId === grantId
  )
}

function parseLocalNotificationRoute(value: unknown) {
  if (typeof value !== "object" || value === null) return null
  const route = value as Record<string, unknown>
  return typeof route.conversationId === "string" &&
    route.conversationId &&
    typeof route.serverId === "string" && route.serverId &&
    typeof route.serverUrl === "string" && route.serverUrl &&
    typeof route.userId === "string" && route.userId &&
    typeof route.accountId === "string" && route.accountId &&
    Number.isFinite(route.generation)
    ? { accountId: route.accountId, conversationId: route.conversationId, generation: route.generation as number,
        target: { id: route.serverId, url: route.serverUrl, userId: route.userId } }
    : null
}
