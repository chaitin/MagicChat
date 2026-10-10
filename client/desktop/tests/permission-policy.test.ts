import assert from "node:assert/strict"
import test from "node:test"
import { isAllowedMainWindowPermission } from "../src/main/permission-policy.ts"

test("allows notifications from the main frame of the main window", () => {
  assert.equal(isAllowedMainWindowPermission("notifications", true, true), true)
})

test("rejects notification access outside the main window's main frame", () => {
  assert.equal(isAllowedMainWindowPermission("notifications", false, true), false)
  assert.equal(isAllowedMainWindowPermission("notifications", true, false), false)
})

test("keeps all other web permissions disabled", () => {
  assert.equal(isAllowedMainWindowPermission("media", true, true), false)
  assert.equal(isAllowedMainWindowPermission("geolocation", true, true), false)
})
