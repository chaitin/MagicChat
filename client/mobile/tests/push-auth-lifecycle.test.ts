import assert from "node:assert/strict"
import test from "node:test"

import { runSignOutOperation } from "@/data/auth/sign-out-operation"

test("successful logout queues push revocation before invalidating the session", async () => {
  const calls: string[] = []
  await runSignOutOperation({
    deactivatePush: async () => {
      calls.push("deactivate")
    },
    invalidateSession: async () => {
      calls.push("invalidate")
    },
    isCurrentSession: () => true,
    logout: async () => {
      calls.push("logout")
    },
  })
  assert.deepEqual(calls, ["logout", "deactivate", "invalidate"])
})

test("failed logout leaves the current push delegation untouched", async () => {
  const calls: string[] = []
  await assert.rejects(
    runSignOutOperation({
      deactivatePush: async () => {
        calls.push("deactivate")
      },
      invalidateSession: async () => {
        calls.push("invalidate")
      },
      isCurrentSession: () => true,
      logout: async () => {
        calls.push("logout")
        throw new Error("offline")
      },
    }),
    /offline/
  )
  assert.deepEqual(calls, ["logout"])
})

test("successful logout still revokes the old push grant after session replacement", async () => {
  const calls: string[] = []
  await runSignOutOperation({
    deactivatePush: async () => {
      calls.push("deactivate")
    },
    invalidateSession: async () => {
      calls.push("invalidate")
    },
    isCurrentSession: () => false,
    logout: async () => {
      calls.push("logout")
    },
  })
  assert.deepEqual(calls, ["logout", "deactivate"])
})
