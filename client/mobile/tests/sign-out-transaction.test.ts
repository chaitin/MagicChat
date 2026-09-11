import assert from "node:assert/strict"
import test from "node:test"

import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { runAccountSignOutTransaction, selectRecentReadyAccount, type SignOutTransactionFailureStage } from "@/data/auth/sign-out-transaction"
import type { AccountRecord } from "@/data/auth/account-store"

const targetA = { id: "server", url: "https://a.example.com", userId: "a" }
const targetB = { id: "server", url: "https://b.example.com", userId: "b" }

type InjectedStage = SignOutTransactionFailureStage | null

async function scenario(failure: InjectedStage, isCurrent = true, remoteInvalidated = true, hasCandidate = true) {
  const runtime = new AccountAuthRuntime({ getCredential: async () => ({ status: "valid", credential: { token: "secret", expiresAt: "2099-01-01T00:00:00Z" } }) })
  runtime.install({ accountId: "A", generation: 1, target: targetA })
  let phase = "signing-out"
  let rollback = 0
  let unsafe = 0
  let removed = false
  const preparation = { accountId: "B", generation: 2, target: targetB }
  const operation = runAccountSignOutTransaction({
    isCurrent,
    prepareCandidate: async () => {
      if (!hasCandidate) return undefined
      runtime.prepare(preparation)
      if (failure === "candidate-bootstrap") throw new Error("bootstrap")
      return preparation
    },
    cancelPreparation: (value) => runtime.cancelPreparation(value),
    logout: async () => {
      if (failure === "logout") throw new Error("logout")
      return remoteInvalidated
    },
    afterLogout: async () => {
      if (failure === "cleanup-queue") throw new Error("queue write")
    },
    remove: async () => {
      if (failure === "remove") throw new Error("remove")
      removed = true
    },
    commitCandidate: async () => {
      if (failure === "candidate-cas") throw new Error("cas")
    },
    onSuccess: async (value) => {
      if (!isCurrent) { phase = "authenticated"; return }
      runtime.install(value ?? null); phase = value ? "authenticated" : "anonymous"
    },
    onSafeRollback: async () => { rollback += 1; phase = "authenticated" },
    onUnsafeFailure: async () => { unsafe += 1; phase = "degraded"; runtime.install(null) },
  })
  if (failure) await assert.rejects(operation)
  else await operation
  return { phase, rollback, unsafe, removed, acceptsB: runtime.isCurrent({ accountId: "B", generation: 2 }) }
}

test("candidate selection uses newest ready account and excludes signed-out/reauth accounts", () => {
  const account = (id: string, lastUsedAt: string, status: AccountRecord["status"] = "ready"): AccountRecord =>
    ({ id, serverId: id, url: `https://${id}.example.com`, userId: id, name: id, lastUsedAt, status })
  const selected = selectRecentReadyAccount([
    account("A", "2026-01-04T00:00:00Z"),
    account("old", "2026-01-01T00:00:00Z"),
    account("reauth", "2026-01-05T00:00:00Z", "reauth-required"),
    account("new", "2026-01-03T00:00:00Z"),
  ], "A")
  assert.equal(selected?.id, "new")
  assert.equal(selectRecentReadyAccount([account("A", "2026-01-01T00:00:00Z")], "A"), undefined)
})

test("successful current logout commits bootstrapped candidate without stale preparation", async () => {
  const result = await scenario(null)
  assert.equal(result.phase, "authenticated")
  assert.equal(result.removed, true)
  assert.equal(result.acceptsB, true)
})

test("last current account logout reaches anonymous", async () => {
  const result = await scenario(null, true, true, false)
  assert.equal(result.phase, "anonymous")
  assert.equal(result.removed, true)
  assert.equal(result.acceptsB, false)
})

test("candidate bootstrap and logout failures restore current and clear preparation", async () => {
  for (const stage of ["candidate-bootstrap", "logout"] as const) {
    const result = await scenario(stage)
    assert.deepEqual({ phase: result.phase, rollback: result.rollback, unsafe: result.unsafe, acceptsB: result.acceptsB },
      { phase: "authenticated", rollback: 1, unsafe: 0, acceptsB: false })
  }
})

test("queue persistence failure after server logout blocks credential removal and becomes retryable degraded", async () => {
  const result = await scenario("cleanup-queue")
  assert.equal(result.removed, false)
  assert.deepEqual({ phase: result.phase, rollback: result.rollback, unsafe: result.unsafe, acceptsB: result.acceptsB },
    { phase: "degraded", rollback: 0, unsafe: 1, acceptsB: false })
})

test("remote-invalidated remove and post-remove CAS failures become safe degraded", async () => {
  const remove = await scenario("remove")
  assert.deepEqual({ phase: remove.phase, rollback: remove.rollback, unsafe: remove.unsafe, acceptsB: remove.acceptsB },
    { phase: "degraded", rollback: 0, unsafe: 1, acceptsB: false })
  const cas = await scenario("candidate-cas")
  assert.equal(cas.removed, true)
  assert.deepEqual({ phase: cas.phase, rollback: cas.rollback, unsafe: cas.unsafe, acceptsB: cas.acceptsB },
    { phase: "degraded", rollback: 0, unsafe: 1, acceptsB: false })
})

test("local-only remove failure can roll back because remote session remains valid", async () => {
  const result = await scenario("remove", true, false)
  assert.equal(result.phase, "authenticated")
  assert.equal(result.rollback, 1)
  assert.equal(result.acceptsB, false)
})

test("successful inactive logout removes only that account and keeps current runtime", async () => {
  const result = await scenario(null, false, true, false)
  assert.equal(result.phase, "authenticated")
  assert.equal(result.removed, true)
  assert.equal(result.acceptsB, false)
})

test("inactive logout failure never changes current runtime", async () => {
  const result = await scenario("logout", false)
  assert.equal(result.phase, "authenticated")
  assert.equal(result.rollback, 1)
  assert.equal(result.unsafe, 0)
  assert.equal(result.acceptsB, false)
})
