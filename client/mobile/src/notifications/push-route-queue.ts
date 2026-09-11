import type { PendingPushRoute } from "@/notifications/push-types"

export const MAX_PENDING_PUSH_ROUTES = 16

export function appendPendingPushRoute(
  routes: PendingPushRoute[],
  value: PendingPushRoute
) {
  const withoutDuplicate = routes.filter(
    (route) => !pendingPushRoutesMatch(route, value)
  )
  return [...withoutDuplicate, value].slice(-MAX_PENDING_PUSH_ROUTES)
}

export function removePendingPushRoute(
  routes: PendingPushRoute[],
  value: PendingPushRoute
) {
  return routes.filter((route) => !pendingPushRoutesMatch(route, value))
}

function pendingPushRoutesMatch(
  first: PendingPushRoute,
  second: PendingPushRoute
) {
  return (
    first.grantId === second.grantId && first.routeToken === second.routeToken
  )
}
