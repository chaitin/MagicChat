import { installTestAccountRuntime } from "./auth-runtime-test-helper.ts"
import assert from "node:assert/strict"
import test from "node:test"

import type { ApiFetch } from "@/data/api-client"
import { logoutLegacyCookieSession } from "@/data/auth/auth-api"
import {
  createActivePushGrant,
  registerPushInstallation,
  renewPushGrant,
} from "@/notifications/push-gateway-api"
import {
  registerPrivatePushGrant,
  resolvePrivatePushRoute,
} from "@/notifications/push-private-server-api"
import {
  getPushRetryDelay,
  isPendingPushRouteExpired,
  parsePendingPushRouteQueue,
  parsePushDelegation,
  parsePushNotificationData,
  pushSynchronizationShouldRetry,
  shouldRefreshPrivateRegistration,
  shouldRenewPushGrant,
  targetsMatch,
} from "@/notifications/push-types"

test("legacy delegations require the current private registration version", () => {
  const parsed = parsePushDelegation({
    accountId: "account-1",
    expiresAt: "2099-01-01T00:00:00Z",
    grantId: "grant-1",
    installationId: "installation-1",
    lastSyncedAt: "2026-08-28T00:00:00Z",
    platform: "ios",
    sendToken: "send-token",
    status: "registered",
    target: {
      id: "server-1",
      url: "https://private.example",
      userId: "user-1",
    },
  })
  assert.equal(parsed?.privateRegistrationVersion, 1)
})

test("parses only fixed-template push notification routes", () => {
  assert.deepEqual(
    parsePushNotificationData({
      event: "message.created",
      grant_id: "grant-1",
      route_token: "r".repeat(43),
    }),
    {
      event: "message.created",
      grantId: "grant-1",
      routeToken: "r".repeat(43),
    }
  )
  assert.equal(
    parsePushNotificationData({
      event: "message.created",
      grant_id: "grant-1",
      route_token: "short",
      server_url: "https://attacker.example",
    }),
    null
  )
})

test("pending route storage accepts legacy records and queue records", () => {
  const route = {
    grantId: "grant-1",
    receivedAt: "2026-08-27T00:00:00Z",
    routeToken: "r".repeat(43),
  }
  assert.deepEqual(parsePendingPushRouteQueue(route), [route])
  assert.deepEqual(parsePendingPushRouteQueue([route]), [route])
  assert.equal(parsePendingPushRouteQueue([route, { broken: true }]), null)
})

test("compares complete authenticated push targets", () => {
  const target = {
    id: "server-1",
    url: "https://chat.example/",
    userId: "user-1",
  }
  assert.equal(
    targetsMatch(target, {
      id: "server-1",
      url: "https://chat.example",
      userId: "user-1",
    }),
    true
  )
  assert.equal(targetsMatch(target, { ...target, userId: "user-2" }), false)
})

test("calculates grant renewal, registration refresh, and route expiration", () => {
  const now = Date.parse("2026-08-27T00:00:00Z")
  assert.equal(
    shouldRenewPushGrant("2026-09-02T00:00:00Z", now),
    true
  )
  assert.equal(
    shouldRenewPushGrant("2026-09-10T00:00:00Z", now),
    false
  )
  assert.equal(
    shouldRefreshPrivateRegistration("2026-08-25T00:00:00Z", now),
    true
  )
  assert.equal(getPushRetryDelay(0), 5_000)
  assert.equal(getPushRetryDelay(1), 30_000)
  assert.equal(getPushRetryDelay(99), 300_000)
  assert.equal(pushSynchronizationShouldRetry({ status: 503 }), true)
  assert.equal(
    pushSynchronizationShouldRetry({ code: "push_disabled", status: 503 }),
    false
  )
  assert.equal(
    pushSynchronizationShouldRetry({ code: "push_user_disabled" }),
    false
  )
  assert.equal(
    pushSynchronizationShouldRetry({ code: "grant_limit_reached", status: 429 }),
    false
  )
  assert.equal(
    isPendingPushRouteExpired(
      {
        grantId: "grant-1",
        receivedAt: "2026-08-19T00:00:00Z",
        routeToken: "r".repeat(43),
      },
      now
    ),
    true
  )
})

test("uses the fixed public gateway and installation authorization", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = []
  const responses = [
    {
      data: {
        installation_id: "installation-1",
        management_token: "management-token",
      },
      success: true,
    },
    {
      data: {
        expires_at: "2026-09-27T00:00:00Z",
        grant_id: "grant-1",
        send_token: "send-token",
      },
      success: true,
    },
    {
      data: {
        expires_at: "2026-10-27T00:00:00Z",
        grant_id: "grant-1",
      },
      success: true,
    },
  ]
  const fetcher: ApiFetch = async (url, init) => {
    requests.push({ init, url })
    return Response.json(responses.shift(), { status: 201 })
  }

  const installation = await registerPushInstallation(
    {
      appVersion: "1.2.0",
      environment: "development",
      platform: "ios",
      provider: "apns",
      providerToken: "apns-token",
    },
    { fetcher }
  )
  const grant = await createActivePushGrant(
    installation.installationId,
    installation.managementToken,
    { fetcher }
  )
  const renewed = await renewPushGrant(
    grant.grantId,
    installation.managementToken,
    { fetcher }
  )

  assert.equal(
    requests[0]?.url,
    "https://push.jiying.chat/api/v1/installations"
  )
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    app_version: "1.2.0",
    environment: "development",
    platform: "ios",
    provider: "apns",
    provider_token: "apns-token",
  })
  assert.equal(
    new Headers(requests[1]?.init?.headers).get("authorization"),
    "Installation management-token"
  )
  assert.equal(renewed.expiresAt, "2026-10-27T00:00:00Z")
})

test("logout binds private grant revocation to the current installation", async () => {
  let request: { init?: RequestInit; url: string } | undefined
  const fetcher: ApiFetch = async (url, init) => {
    request = { init, url }
    return Response.json({ data: {}, success: true })
  }
  await logoutLegacyCookieSession("https://private.example", {
    fetcher,
    pushInstallationId: "installation-1",
  })
  assert.equal(request?.url, "https://private.example/api/client/auth/logout")
  assert.equal(
    new Headers(request?.init?.headers).get("x-push-installation-id"),
    "installation-1"
  )
})

test("registers grants and resolves routes only through the mapped private server", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = []
  const target = {
    id: "server-1",
    url: "https://private.example/",
    userId: "user-1",
  }
  const responses = [
    { data: {}, success: true },
    {
      data: {
        conversation_id: "conversation-1",
        message_id: "message-1",
      },
      success: true,
    },
  ]
  const fetcher: ApiFetch = async (url, init) => {
    requests.push({ init, url })
    return Response.json(responses.shift(), { status: 200 })
  }
  installTestAccountRuntime(target)
  await registerPrivatePushGrant(
    target,
    {
      expiresAt: "2026-09-27T00:00:00Z",
      grantId: "grant-1",
      installationId: "installation-1",
      lastSyncedAt: null,
      platform: "ios",
      sendToken: "send-token",
      status: "pending_registration",
      target,
    },
    { fetcher }
  )
  const route = await resolvePrivatePushRoute(target, "r".repeat(43), {
    fetcher,
  })

  assert.equal(
    requests[0]?.url,
    "https://private.example/api/client/push/grants"
  )
  assert.equal(requests[0]?.init?.credentials, "include")
  assert.equal(
    requests[1]?.url,
    "https://private.example/api/client/push/routes/resolve"
  )
  assert.equal(requests[1]?.init?.method, "POST")
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    route_token: "r".repeat(43),
  })
  assert.deepEqual(route, {
    conversationId: "conversation-1",
    messageId: "message-1",
  })
})
