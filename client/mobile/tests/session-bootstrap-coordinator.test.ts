import assert from "node:assert/strict"
import test from "node:test"

import type { AuthenticatedTarget } from "../src/core/server-target.ts"
import { SessionBootstrapCoordinator, type SessionBootstrapOperations } from "../src/features/bootstrap/session-bootstrap-coordinator.ts"

const a: AuthenticatedTarget = { id: "server", url: "https://a.test", userId: "u1" }
const b: AuthenticatedTarget = { id: "server", url: "https://b.test", userId: "u1" }

function operations(run: (name: string, current: () => boolean) => Promise<void>): SessionBootstrapOperations {
  return {
    messages: ({ isCurrent }) => run("messages", isCurrent),
    currentUser: ({ isCurrent }) => run("currentUser", isCurrent),
    contacts: ({ isCurrent }) => run("contacts", isCurrent),
    projects: ({ isCurrent }) => run("projects", isCurrent),
  }
}

test("same session shares inflight and runs every operation once", async () => {
  const counts = new Map<string, number>()
  const coordinator = new SessionBootstrapCoordinator()
  const ops = operations(async (name) => { counts.set(name, (counts.get(name) ?? 0) + 1) })
  const first = coordinator.start(a, ops)
  const second = coordinator.start(a, ops)
  assert.equal(first, second)
  await first
  assert.deepEqual([...counts.values()], [1, 1, 1, 1])
  assert.equal(coordinator.getSnapshot(a).phase, "ready")
  assert.equal("realtime" in coordinator.getSnapshot(a).operations, false)
  await coordinator.start(a, ops)
  assert.deepEqual([...counts.values()], [1, 1, 1, 1])
})

test("targets are isolated and failed operations alone retry", async () => {
  const attempts = new Map<string, number>()
  const coordinator = new SessionBootstrapCoordinator()
  const ops = operations(async (name) => {
    const key = `${name}`
    attempts.set(key, (attempts.get(key) ?? 0) + 1)
    if (name === "contacts" && attempts.get(key) === 1) throw new Error("offline")
  })
  await assert.rejects(coordinator.start(a, ops), /offline/)
  assert.equal(coordinator.getSnapshot(a).phase, "degraded")
  await coordinator.refresh(a)
  assert.equal(attempts.get("contacts"), 2)
  assert.equal(attempts.get("messages"), 1)
  await coordinator.start(b, operations(async () => undefined))
  assert.equal(coordinator.getSnapshot(b).phase, "ready")
})

test("rapid target switch prevents old operations from publishing into current projections", async () => {
  let releaseOld!: () => void
  const oldBlocked = new Promise<void>((resolve) => { releaseOld = resolve })
  const projections: string[] = []
  const coordinator = new SessionBootstrapCoordinator()
  const oldRun = coordinator.start(a, operations(async (name, isCurrent) => {
    await oldBlocked
    if (isCurrent()) projections.push(`old:${name}`)
  }))

  coordinator.invalidate(a)
  await coordinator.start(b, operations(async (name, isCurrent) => {
    if (isCurrent()) projections.push(`new:${name}`)
  }))
  releaseOld()
  await assert.rejects(oldRun, /失效/)

  assert.deepEqual(projections, [
    "new:messages", "new:currentUser", "new:contacts", "new:projects",
  ])
  assert.equal(coordinator.getSnapshot(a).phase, "idle")
  assert.equal(coordinator.getSnapshot(b).phase, "ready")
})

test("invalidate prevents an old completion from becoming current", async () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  let wasCurrent = true
  const coordinator = new SessionBootstrapCoordinator()
  const pending = coordinator.start(a, operations(async (_name, current) => {
    await wait
    wasCurrent = wasCurrent && current()
  }))
  coordinator.invalidate(a)
  release()
  await assert.rejects(pending, /失效/)
  assert.equal(wasCurrent, false)
  assert.equal(coordinator.getSnapshot(a).phase, "idle")
})

test("unauthorized invalidates only once even when operations fail together", async () => {
  let invalidations = 0
  const coordinator = new SessionBootstrapCoordinator((error) => error instanceof Error && error.message === "401")
  await assert.rejects(coordinator.start(a, operations(async () => { throw new Error("401") }), {
    onUnauthorized: () => { invalidations += 1 },
  }))
  assert.equal(invalidations, 1)
})

test("provider remount contract does not repeat completed bootstrap", async () => {
  const coordinator = new SessionBootstrapCoordinator()
  let runs = 0
  const ops = operations(async () => { runs += 1 })
  await coordinator.start(a, ops)
  // TargetClientDataProvider calls start again when the provider remounts.
  await coordinator.start(a, ops)
  assert.equal(runs, 4)
})

test("subscriptions are released across remounts", async () => {
  const coordinator = new SessionBootstrapCoordinator()
  let calls = 0
  const unsubscribe = coordinator.subscribe(a, () => { calls += 1 })
  unsubscribe()
  await coordinator.start(a, operations(async () => undefined))
  assert.equal(calls, 0)
})
