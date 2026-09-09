import type { AuthenticatedTarget } from "@/core/server-target"
import { createAccountId } from "@/data/auth/account-store"

export const PUSH_GATEWAY_URL = "https://push.jiying.chat"
export const PUSH_GRANT_RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000
export const PUSH_REGISTRATION_REFRESH_MS = 24 * 60 * 60 * 1_000
export const PUSH_ROUTE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

const PUSH_ROUTE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000] as const

export type PushEnvironment = "development" | "production"
export type PushPlatform = "android" | "ios"
export type PushProviderName = "apns" | "jpush"

export type PushInstallation = {
  appVersion: string
  environment: PushEnvironment
  installationId: string
  managementToken: string
  platform: PushPlatform
  provider: PushProviderName
  providerToken: string
}

export type PushDelegationStatus =
  | "pending_registration"
  | "pending_revocation"
  | "registered"

export type PushAccountIdentity = {
  accountId: string
  generation: number
  target: AuthenticatedTarget
}

export type PushDelegation = {
  accountId: string
  expiresAt: string
  grantId: string
  installationId: string
  lastSyncedAt: string | null
  platform: PushPlatform
  privateRegistrationVersion?: number
  sendToken: string
  status: PushDelegationStatus
  target: AuthenticatedTarget
}

export type PendingPushRevocation = {
  accountId: string
  grantId: string
  installationId: string
  gatewayRevoked?: boolean
  privateRevoked?: boolean
  queuedAt: string
  target: AuthenticatedTarget
}

export type PendingPushRoute = {
  grantId: string
  receivedAt: string
  routeToken: string
}

export type PushNotificationData = {
  event: "message.created"
  grantId: string
  routeToken: string
}

export function targetsMatch(
  first: AuthenticatedTarget,
  second: AuthenticatedTarget
) {
  return (
    first.id === second.id &&
    normalizeURL(first.url) === normalizeURL(second.url) &&
    first.userId === second.userId
  )
}

export function shouldRenewPushGrant(expiresAt: string, now = Date.now()) {
  const expiration = Date.parse(expiresAt)
  return (
    !Number.isFinite(expiration) ||
    expiration <= now + PUSH_GRANT_RENEWAL_WINDOW_MS
  )
}

export function shouldRefreshPrivateRegistration(
  lastSyncedAt: string | null,
  now = Date.now()
) {
  if (!lastSyncedAt) return true
  const lastSync = Date.parse(lastSyncedAt)
  return (
    !Number.isFinite(lastSync) ||
    lastSync <= now - PUSH_REGISTRATION_REFRESH_MS
  )
}

export function getPushRetryDelay(attempt: number) {
  const index = Math.max(
    0,
    Math.min(Math.trunc(attempt), PUSH_ROUTE_RETRY_DELAYS_MS.length - 1)
  )
  return PUSH_ROUTE_RETRY_DELAYS_MS[index]
}

export function pushSynchronizationShouldRetry(error: unknown) {
  if (!isRecord(error)) return true
  const code = typeof error.code === "string" ? error.code : ""
  if (
    code === "push_disabled" ||
    code === "grant_limit_reached" ||
    code === "unauthorized" ||
    code === "invalid_request" ||
    code === "jpush_consent_required" ||
    code === "push_user_disabled" ||
    code === "android_provider_unavailable" ||
    code === "unsupported_provider"
  ) {
    return false
  }
  const status = typeof error.status === "number" ? error.status : undefined
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export function isPendingPushRouteExpired(
  route: PendingPushRoute,
  now = Date.now()
) {
  const receivedAt = Date.parse(route.receivedAt)
  return (
    !Number.isFinite(receivedAt) || receivedAt <= now - PUSH_ROUTE_RETENTION_MS
  )
}

export function parsePushNotificationData(
  value: unknown
): PushNotificationData | null {
  if (!isRecord(value)) return null
  const event = value.event
  const grantId = value.grant_id
  const routeToken = value.route_token
  if (
    event !== "message.created" ||
    typeof grantId !== "string" ||
    !grantId.trim() ||
    typeof routeToken !== "string" ||
    routeToken.trim().length < 32
  ) {
    return null
  }
  return {
    event,
    grantId: grantId.trim(),
    routeToken: routeToken.trim(),
  }
}

export function parsePushInstallation(value: unknown): PushInstallation | null {
  if (!isRecord(value)) return null
  const platform = value.platform === "android" ? "android" : "ios"
  const provider = value.provider === "jpush" ? "jpush" : "apns"
  if (
    typeof value.appVersion !== "string" ||
    (value.environment !== "development" &&
      value.environment !== "production") ||
    typeof value.installationId !== "string" ||
    !value.installationId ||
    typeof value.managementToken !== "string" ||
    !value.managementToken ||
    typeof value.providerToken !== "string" ||
    !value.providerToken ||
    (platform === "ios" && provider !== "apns") ||
    (platform === "android" && provider !== "jpush") ||
    (provider === "jpush" && value.environment !== "production")
  ) {
    return null
  }
  return {
    appVersion: value.appVersion,
    environment: value.environment,
    installationId: value.installationId,
    managementToken: value.managementToken,
    platform,
    provider,
    providerToken: value.providerToken,
  }
}

export function parsePushDelegation(value: unknown): PushDelegation | null {
  if (!isRecord(value) || !isAuthenticatedTarget(value.target)) return null
  const platform = value.platform === "android" ? "android" : "ios"
  if (
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    typeof value.grantId !== "string" ||
    !value.grantId ||
    typeof value.installationId !== "string" ||
    !value.installationId ||
    (value.lastSyncedAt !== null && typeof value.lastSyncedAt !== "string") ||
    typeof value.sendToken !== "string" ||
    !value.sendToken ||
    (value.status !== "pending_registration" &&
      value.status !== "pending_revocation" &&
      value.status !== "registered")
  ) {
    return null
  }
  return {
    accountId: typeof value.accountId === "string" && value.accountId
      ? value.accountId : createAccountId(value.target.url, value.target.userId),
    expiresAt: value.expiresAt,
    grantId: value.grantId,
    installationId: value.installationId,
    lastSyncedAt: value.lastSyncedAt,
    platform,
    privateRegistrationVersion:
      typeof value.privateRegistrationVersion === "number" &&
      Number.isInteger(value.privateRegistrationVersion)
        ? value.privateRegistrationVersion
        : 1,
    sendToken: value.sendToken,
    status: value.status,
    target: value.target,
  }
}

export function parsePendingPushRevocation(value: unknown): PendingPushRevocation | null {
  if (!isRecord(value) || !isAuthenticatedTarget(value.target) ||
    typeof value.accountId !== "string" || !value.accountId ||
    typeof value.grantId !== "string" || !value.grantId ||
    typeof value.installationId !== "string" || !value.installationId ||
    typeof value.queuedAt !== "string" || !Number.isFinite(Date.parse(value.queuedAt))) return null
  return { accountId: value.accountId, grantId: value.grantId, installationId: value.installationId,
    gatewayRevoked: value.gatewayRevoked === true, privateRevoked: value.privateRevoked === true,
    queuedAt: value.queuedAt, target: value.target }
}

export function parsePendingPushRevocationQueue(value: unknown): PendingPushRevocation[] | null {
  if (!Array.isArray(value)) return null
  const entries = value.map(parsePendingPushRevocation)
  return entries.every((entry): entry is PendingPushRevocation => entry !== null) ? entries : null
}

export function parsePendingPushRoute(value: unknown): PendingPushRoute | null {
  if (!isRecord(value)) return null
  if (
    typeof value.grantId !== "string" ||
    !value.grantId ||
    typeof value.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(value.receivedAt)) ||
    typeof value.routeToken !== "string" ||
    value.routeToken.length < 32
  ) {
    return null
  }
  return {
    grantId: value.grantId,
    receivedAt: value.receivedAt,
    routeToken: value.routeToken,
  }
}

export function parsePendingPushRouteQueue(
  value: unknown
): PendingPushRoute[] | null {
  if (!Array.isArray(value)) {
    const legacy = parsePendingPushRoute(value)
    return legacy ? [legacy] : null
  }
  const routes = value.map(parsePendingPushRoute)
  return routes.every((route): route is PendingPushRoute => route !== null)
    ? routes
    : null
}

function isAuthenticatedTarget(value: unknown): value is AuthenticatedTarget {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Boolean(value.id) &&
    typeof value.url === "string" &&
    Boolean(value.url) &&
    typeof value.userId === "string" &&
    Boolean(value.userId)
  )
}

function normalizeURL(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
