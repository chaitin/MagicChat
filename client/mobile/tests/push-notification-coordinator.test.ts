import assert from "node:assert/strict"
import test from "node:test"

import { PushNotificationCoordinator } from "@/notifications/push-notification-coordinator"
import {
  appendPendingPushRoute,
  MAX_PENDING_PUSH_ROUTES,
  removePendingPushRoute,
} from "@/notifications/push-route-queue"
import type {
  PendingPushRoute,
  PushDelegation,
} from "@/notifications/push-types"

const TARGET = {
  id: "server-1",
  url: "https://chat.example.com",
  userId: "user-1",
}
const IDENTITY = { accountId: "account-1", generation: 1, target: TARGET }
const DELEGATION: PushDelegation = {
  accountId: IDENTITY.accountId,
  expiresAt: "2099-01-01T00:00:00.000Z",
  grantId: "grant-1",
  installationId: "installation-1",
  lastSyncedAt: "2026-01-01T00:00:00.000Z",
  platform: "ios",
  sendToken: "send-token",
  status: "registered",
  target: TARGET,
}

function createHarness(initialRoutes: PendingPushRoute[] = []) {
  let routes = [...initialRoutes]
  let clearCount = 0
  let resolveCount = 0
  const coordinator = new PushNotificationCoordinator({
    clearLastResponse: () => {
      clearCount += 1
    },
    consumeRoute: async (route) => {
      routes = removePendingPushRoute(routes, route)
    },
    enqueueRoute: async (route) => {
      routes = appendPendingPushRoute(routes, route)
    },
    isMissingRouteError: (error) =>
      typeof error === "object" && error !== null && "missing" in error,
    loadDelegation: async () => DELEGATION,
    loadRoutes: async () => routes,
    replaceRoutes: async (next) => {
      routes = [...next]
    },
    resolveRoute: async () => {
      resolveCount += 1
      return { conversationId: "conversation-1", messageId: "message-1" }
    },
  })
  return {
    coordinator,
    get clearCount() {
      return clearCount
    },
    get resolveCount() {
      return resolveCount
    },
    get routes() {
      return routes
    },
  }
}

function remoteResponse(identifier: string, routeToken = "r".repeat(43)) {
  return {
    data: {
      event: "message.created",
      grant_id: "grant-1",
      route_token: routeToken,
    },
    date: Date.now(),
    identifier,
  }
}

test("duplicate notification responses enqueue one pending route", async () => {
  const harness = createHarness()
  const first = harness.coordinator.handleResponse({
    navigateLocal: async () => undefined,
    response: remoteResponse("notification-1"),
    identity: IDENTITY,
    isCurrent: () => true,
  })
  const second = harness.coordinator.handleResponse({
    navigateLocal: async () => undefined,
    response: remoteResponse("notification-1"),
    identity: IDENTITY,
    isCurrent: () => true,
  })

  assert.equal(await first, true)
  assert.equal(await second, false)
  assert.equal(harness.routes.length, 1)
  assert.equal(harness.clearCount, 1)
})

test("failed navigation preserves the pending route for a later retry", async () => {
  const pending = {
    grantId: "grant-1",
    receivedAt: new Date().toISOString(),
    routeToken: "r".repeat(43),
  }
  const harness = createHarness([pending])

  await assert.rejects(
    harness.coordinator.openPendingRoute({
      navigate: async () => {
        throw new Error("navigation failed")
      },
      identity: IDENTITY,
    isCurrent: () => true,
    }),
    /navigation failed/
  )
  assert.deepEqual(harness.routes, [pending])

  let navigated = false
  await harness.coordinator.openPendingRoute({
    navigate: async () => {
      navigated = true
    },
    identity: IDENTITY,
    isCurrent: () => true,
  })
  assert.equal(navigated, true)
  assert.deepEqual(harness.routes, [])
  assert.equal(harness.resolveCount, 2)
})

test("local response can retry after synchronous navigation failure", async () => {
  const harness = createHarness()
  const response = {
    data: { accountId: IDENTITY.accountId, conversationId: "conversation-1", generation: 1, serverId: "server-1", serverUrl: TARGET.url, userId: TARGET.userId },
    date: Date.now(),
    identifier: "local-1",
  }
  await assert.rejects(
    harness.coordinator.handleResponse({
      navigateLocal: () => {
        throw new Error("router unavailable")
      },
      response,
      identity: IDENTITY,
    isCurrent: () => true,
    }),
    /router unavailable/
  )
  let attempts = 0
  await harness.coordinator.handleResponse({
    navigateLocal: async () => {
      attempts += 1
    },
    response,
    identity: IDENTITY,
    isCurrent: () => true,
  })
  assert.equal(attempts, 1)
  assert.equal(harness.clearCount, 1)
})

test("account switch while loadDelegation is pending cannot enqueue old payload", async () => {
  let release!: (delegation: PushDelegation) => void
  const loading = new Promise<PushDelegation>((resolve) => { release = resolve })
  const enqueued: PendingPushRoute[] = []
  let current = true
  const coordinator = new PushNotificationCoordinator({
    clearLastResponse: () => undefined,
    consumeRoute: async () => undefined,
    enqueueRoute: async (route) => { enqueued.push(route) },
    isMissingRouteError: () => false,
    loadDelegation: () => loading,
    loadRoutes: async () => [],
    replaceRoutes: async () => undefined,
    resolveRoute: async () => ({ conversationId: "c", messageId: "m" }),
  })
  const handling = coordinator.handleResponse({ identity: IDENTITY, isCurrent: () => current,
    navigateLocal: async () => undefined, response: remoteResponse("race") })
  await Promise.resolve()
  current = false
  release(DELEGATION)
  assert.equal(await handling, false)
  assert.deepEqual(enqueued, [])
})

test("generation changing during async enqueue compensates the stale pending route", async () => {
  let release!: () => void
  let current = true
  const routes: PendingPushRoute[] = []
  const coordinator = new PushNotificationCoordinator({
    clearLastResponse: () => undefined,
    consumeRoute: async (route) => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) },
    enqueueRoute: async (route) => { routes.push(route); await new Promise<void>((resolve) => { release = resolve }) },
    isMissingRouteError: () => false,
    loadDelegation: async () => DELEGATION,
    loadRoutes: async () => routes,
    replaceRoutes: async () => undefined,
    resolveRoute: async () => ({ conversationId: "c", messageId: "m" }),
  })
  const handling = coordinator.handleResponse({ identity: IDENTITY, isCurrent: () => current,
    navigateLocal: async () => undefined, response: remoteResponse("enqueue-race") })
  while (!release) await Promise.resolve()
  current = false
  release()
  assert.equal(await handling, false)
  assert.deepEqual(routes, [])
})

test("wrong account and stale generation responses never enqueue or navigate", async () => {
  const harness = createHarness()
  let navigated = 0
  const stale = { ...IDENTITY, generation: 0 }
  assert.equal(await harness.coordinator.handleResponse({
    identity: stale, isCurrent: () => false,
    navigateLocal: async () => { navigated++ }, response: remoteResponse("stale"),
  }), false)
  const wrongLocal = {
    data: { accountId: "other", conversationId: "conversation-1", generation: IDENTITY.generation,
      serverId: TARGET.id, serverUrl: TARGET.url, userId: TARGET.userId },
    date: Date.now(), identifier: "wrong-local",
  }
  assert.equal(await harness.coordinator.handleResponse({
    identity: IDENTITY, isCurrent: () => true,
    navigateLocal: async () => { navigated++ }, response: wrongLocal,
  }), false)
  assert.equal(navigated, 0)
  assert.deepEqual(harness.routes, [])
})

test("generation changing during route resolution drops navigation and Query route consumption", async () => {
  const pending = { grantId: "grant-1", receivedAt: new Date().toISOString(), routeToken: "r".repeat(43) }
  const harness = createHarness([pending])
  let current = true
  let navigated = false
  await harness.coordinator.openPendingRoute({
    identity: IDENTITY,
    isCurrent: () => { const value = current; current = false; return value },
    navigate: async () => { navigated = true },
  })
  assert.equal(navigated, false)
  assert.deepEqual(harness.routes, [pending])
})

test("pending route queue is deduplicated and bounded", () => {
  let routes: PendingPushRoute[] = []
  for (let index = 0; index < MAX_PENDING_PUSH_ROUTES + 3; index += 1) {
    routes = appendPendingPushRoute(routes, {
      grantId: "grant-1",
      receivedAt: new Date(index).toISOString(),
      routeToken: String(index).padStart(32, "r"),
    })
  }
  assert.equal(routes.length, MAX_PENDING_PUSH_ROUTES)
  assert.equal(routes[0]?.routeToken, String(3).padStart(32, "r"))

  const newest = routes.at(-1)
  assert.ok(newest)
  routes = appendPendingPushRoute(routes, {
    ...newest,
    receivedAt: new Date().toISOString(),
  })
  assert.equal(routes.length, MAX_PENDING_PUSH_ROUTES)
  assert.equal(routes.at(-1)?.routeToken, newest.routeToken)
})
