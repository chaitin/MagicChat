import assert from "node:assert/strict"
import test from "node:test"

import { runLoginBootstrapOperations } from "@/features/auth/login-bootstrap-runner"

test("login bootstrap only waits for required identity resources", async () => {
  const completed: string[] = []

  await runLoginBootstrapOperations({
    bootstrapMessages: async () => {
      completed.push("messages")
    },
    fetchContacts: async () => {
      completed.push("contacts")
    },
    fetchCurrentUser: async () => {
      completed.push("current-user")
    },
    fetchProjects: async () => {
      completed.push("projects")
    },
    waitForRealtime: async () => {
      completed.push("realtime")
    },
  })

  assert.deepEqual(completed.sort(), [
    "contacts",
    "current-user",
    "messages",
    "projects",
    "realtime",
  ])
})
