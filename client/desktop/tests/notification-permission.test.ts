import assert from "node:assert/strict"
import test from "node:test"
import {
  checkNotificationPermission,
  getNotificationPermission,
  type NotificationPermissionApi,
} from "../src/renderer/lib/notification-permission.ts"

test("reads notification permission without requesting it", async () => {
  let requests = 0
  const api: NotificationPermissionApi = {
    permission: "denied",
    requestPermission: async () => {
      requests += 1
      return "granted"
    },
  }

  assert.equal(getNotificationPermission(api), "denied")
  assert.equal(await checkNotificationPermission(api, false), "denied")
  assert.equal(requests, 0)
})

test("requests a decision only for the default permission", async () => {
  let requests = 0
  const api: NotificationPermissionApi = {
    permission: "default",
    requestPermission: async () => {
      requests += 1
      return "granted"
    },
  }

  assert.equal(await checkNotificationPermission(api, true), "granted")
  assert.equal(requests, 1)
})

test("Windows native notifications do not depend on renderer web permission", async () => {
  let requests = 0
  const api: NotificationPermissionApi = {
    permission: "default",
    requestPermission: async () => {
      requests += 1
      return "denied"
    },
  }

  assert.equal(getNotificationPermission(api, "windows"), "unsupported")
  assert.equal(await checkNotificationPermission(api, true, "windows"), "unsupported")
  assert.equal(requests, 0)
  assert.equal(getNotificationPermission({ ...api, permission: "denied" }, "windows"), "unsupported")
  assert.equal(getNotificationPermission(api, "macos"), "default")
})

test("treats a missing notification API as unsupported", async () => {
  assert.equal(getNotificationPermission(undefined), "unsupported")
  assert.equal(await checkNotificationPermission(undefined, true), "unsupported")
})
