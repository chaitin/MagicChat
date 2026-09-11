import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("iOS prebuild config selects the matching APNs environment", async () => {
  const [appConfig, plugin] = await Promise.all([
    readFile("app.json", "utf8"),
    readFile("plugins/with-apns-environments.js", "utf8"),
  ])
  assert.ok(
    JSON.parse(appConfig).expo.plugins.includes("./plugins/with-apns-environments")
  )
  assert.match(plugin, /"aps-environment"\] = "\$\(APS_ENVIRONMENT\)"/)
  assert.match(plugin, /APS_ENVIRONMENT = "development"/)
  assert.match(plugin, /APS_ENVIRONMENT = "production"/)
})
