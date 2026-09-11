import assert from "node:assert/strict"
import test from "node:test"

import { navigateThenConsumePushRoute } from "@/notifications/push-navigation"

test("push route is consumed only after navigation succeeds", async () => {
  const calls: string[] = []
  await navigateThenConsumePushRoute({
    consume: async () => {
      calls.push("consume")
    },
    navigate: () => {
      calls.push("navigate")
    },
  })
  assert.deepEqual(calls, ["navigate", "consume"])
})

test("failed navigation keeps the pending push route", async () => {
  let consumed = false
  await assert.rejects(
    navigateThenConsumePushRoute({
      consume: async () => {
        consumed = true
      },
      navigate: () => {
        throw new Error("router not ready")
      },
    }),
    /router not ready/
  )
  assert.equal(consumed, false)
})
