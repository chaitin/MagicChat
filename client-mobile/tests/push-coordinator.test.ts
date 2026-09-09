import assert from "node:assert/strict"
import test from "node:test"

import type { AuthenticatedTarget } from "@/core/server-target"
import {
  classifyPushSynchronizationError,
  PushCoordinator,
  type PushCoordinatorOperations,
} from "@/notifications/push-coordinator"

const TARGET: AuthenticatedTarget = {
  id: "server-1",
  url: "https://chat.example.com",
  userId: "user-1",
}
const IDENTITY = { accountId: "account-1", generation: 1, target: TARGET }

class FakeClock {
  private nextId = 1
  private timers = new Map<number, { callback: () => void; delay: number }>()

  readonly setTimer = (callback: () => void, delay: number) => {
    const id = this.nextId++
    this.timers.set(id, { callback, delay })
    return id as unknown as ReturnType<typeof setTimeout>
  }

  readonly clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as unknown as number)
  }

  delays() {
    return [...this.timers.values()].map((timer) => timer.delay)
  }

  runNext() {
    const next = this.timers.entries().next().value as
      | [number, { callback: () => void; delay: number }]
      | undefined
    if (!next) throw new Error("没有待执行的定时器")
    this.timers.delete(next[0])
    next[1].callback()
  }
}

function createOperations(
  overrides: Partial<PushCoordinatorOperations> = {}
): PushCoordinatorOperations {
  return {
    deactivate: async () => undefined,
    flushPendingRevocation: async () => undefined,
    getInstallationId: async () => undefined,
    queueRevocation: async () => undefined,
    synchronize: async () => true,
    ...overrides,
  }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test("push coordinator retries temporary failures and refreshes registration", async () => {
  const clock = new FakeClock()
  let attempts = 0
  const states: string[] = []
  const coordinator = new PushCoordinator(
    createOperations({
      synchronize: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("offline")
        return true
      },
    }),
    {
      clearTimer: clock.clearTimer,
      refreshDelay: 86_400,
      retryDelay: () => 500,
      setTimer: clock.setTimer,
    }
  )
  coordinator.subscribe(() => states.push(coordinator.getState()))

  coordinator.configure({ enabled: true, identity: IDENTITY })
  await settle()
  assert.equal(attempts, 1)
  assert.equal(coordinator.getState(), "temporarily_unavailable")
  assert.deepEqual(clock.delays(), [500])

  clock.runNext()
  await settle()
  assert.equal(attempts, 2)
  assert.equal(coordinator.getState(), "registered")
  assert.deepEqual(clock.delays(), [86_400])
  assert.deepEqual(states, [
    "synchronizing",
    "temporarily_unavailable",
    "synchronizing",
    "registered",
  ])
})

test("push coordinator exposes terminal synchronization states without retrying", async () => {
  for (const [code, expected] of [
    ["jpush_consent_required", "consent_required"],
    ["push_user_disabled", "user_disabled"],
    ["android_provider_unavailable", "provider_unavailable"],
    ["unsupported_provider", "provider_unavailable"],
    ["push_disabled", "server_disabled"],
    ["grant_limit_reached", "device_limit_reached"],
    ["unauthorized", "unauthorized"],
  ] as const) {
    const clock = new FakeClock()
    const coordinator = new PushCoordinator(
      createOperations({
        synchronize: async () => {
          throw { code, status: code === "unauthorized" ? 401 : 409 }
        },
      }),
      { clearTimer: clock.clearTimer, setTimer: clock.setTimer }
    )
    coordinator.configure({ enabled: true, identity: IDENTITY })
    await settle()
    assert.equal(coordinator.getState(), expected)
    assert.deepEqual(clock.delays(), [])
  }
  assert.equal(
    classifyPushSynchronizationError({ code: "push_disabled" }),
    "server_disabled"
  )
})

test("permission denial is an explicit terminal state", async () => {
  const clock = new FakeClock()
  const coordinator = new PushCoordinator(
    createOperations({ synchronize: async () => false }),
    { clearTimer: clock.clearTimer, setTimer: clock.setTimer }
  )
  coordinator.configure({ enabled: true, identity: IDENTITY })
  await settle()
  assert.equal(coordinator.getState(), "permission_denied")
  assert.deepEqual(clock.delays(), [])
})

test("pause suppresses stale completion and lifecycle operations share one queue", async () => {
  const calls: string[] = []
  let releaseSynchronization: (() => void) | undefined
  const coordinator = new PushCoordinator(
    createOperations({
      getInstallationId: async () => {
        calls.push("installation")
        return "installation-1"
      },
      synchronize: async () => {
        calls.push("synchronize")
        await new Promise<void>((resolve) => {
          releaseSynchronization = resolve
        })
        return true
      },
    })
  )

  coordinator.configure({ enabled: true, identity: IDENTITY })
  await settle()
  coordinator.pause()
  const installation = coordinator.getInstallationId(IDENTITY)
  await settle()
  assert.deepEqual(calls, ["synchronize"])
  assert.equal(coordinator.getState(), "idle")

  releaseSynchronization?.()
  assert.equal(await installation, "installation-1")
  assert.deepEqual(calls, ["synchronize", "installation"])
  assert.equal(coordinator.getState(), "idle")
})

test("account generation switch deactivates old before synchronizing new", async () => {
  const calls: string[] = []
  const coordinator = new PushCoordinator(createOperations({
    deactivate: async (identity) => { calls.push(`deactivate:${identity?.accountId}`) },
    synchronize: async (identity) => { calls.push(`synchronize:${identity.accountId}:${identity.generation}`); return true },
  }))
  coordinator.configure({ enabled: true, identity: IDENTITY })
  await settle()
  calls.length = 0
  const next = { accountId: "account-2", generation: 2, target: { ...TARGET, userId: "user-2" } }
  coordinator.configure({ enabled: true, identity: next })
  await settle()
  assert.deepEqual(calls, ["deactivate:account-1", "synchronize:account-2:2"])
  coordinator.dispose()
})

test("failed old revocation is safely queued before new account activation", async () => {
  const calls: string[] = []
  const coordinator = new PushCoordinator(createOperations({
    deactivate: async (identity) => { calls.push(`deactivate:${identity?.accountId}`); throw new Error("offline") },
    queueRevocation: async (identity) => { calls.push(`queue:${identity.accountId}`) },
    synchronize: async (identity) => { calls.push(`synchronize:${identity.accountId}`); return true },
  }))
  coordinator.configure({ enabled: true, identity: IDENTITY })
  await settle(); calls.length = 0
  coordinator.configure({ enabled: true, identity: { accountId: "account-2", generation: 2, target: { ...TARGET, userId: "user-2" } } })
  await settle()
  assert.deepEqual(calls, ["deactivate:account-1", "queue:account-1", "synchronize:account-2"])
  coordinator.dispose()
})

test("anonymous pending revocation retries with the coordinator clock", async () => {
  const clock = new FakeClock()
  let attempts = 0
  const coordinator = new PushCoordinator(
    createOperations({
      flushPendingRevocation: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("offline")
      },
    }),
    {
      clearTimer: clock.clearTimer,
      retryDelay: () => 250,
      setTimer: clock.setTimer,
    }
  )

  coordinator.configure({ enabled: true, identity: null })
  await settle()
  assert.equal(coordinator.getState(), "temporarily_unavailable")
  assert.deepEqual(clock.delays(), [250])
  clock.runNext()
  await settle()
  assert.equal(attempts, 2)
  assert.equal(coordinator.getState(), "idle")
})
