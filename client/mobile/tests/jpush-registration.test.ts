import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { normalizeJPushNotificationResponse } from "@/notifications/jpush-notification-response"

test("waits briefly for JPush to issue an asynchronous RegistrationID", async () => {
  const source = await readFile(
    new URL("../src/notifications/jpush-registration.ts", import.meta.url),
    "utf8"
  )
  assert.match(source, /REGISTRATION_ID_POLL_ATTEMPTS = 20/)
  assert.match(source, /REGISTRATION_ID_POLL_INTERVAL_MS = 500/)
  assert.match(source, /if \(registrationId\) return registrationId/)
})

test("normalizes only fixed-template JPush notification responses", () => {
  assert.deepEqual(
    normalizeJPushNotificationResponse({
      date: 1_787_814_400_000,
      event: "message.created",
      grantId: "grant-1",
      identifier: "jpush-message-1",
      routeToken: "r".repeat(43),
    }),
    {
      data: {
        event: "message.created",
        grant_id: "grant-1",
        route_token: "r".repeat(43),
      },
      date: 1_787_814_400_000,
      identifier: "jpush-message-1",
    }
  )
  assert.equal(
    normalizeJPushNotificationResponse({
      date: Date.now(),
      event: "other",
      grantId: "grant-1",
      routeToken: "r".repeat(43),
    }),
    null
  )
  assert.equal(
    normalizeJPushNotificationResponse({
      date: Date.now(),
      event: "message.created",
      grantId: "grant-1",
      routeToken: "short",
    }),
    null
  )
})
