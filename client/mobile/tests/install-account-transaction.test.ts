import assert from "node:assert/strict"
import test from "node:test"

import { runInstallAccountTransaction, type InstallAccountFailureStage } from "@/data/auth/install-account-transaction"

test("install transaction revokes new Bearer and restores every failed stage", async () => {
  for (const failed of ["install", "bootstrap", "commit", "publish"] as InstallAccountFailureStage[]) {
    const calls: string[] = []
    let phase = "preparing"
    const fail = (stage: InstallAccountFailureStage) => { if (stage === failed) throw new Error(stage) }
    await assert.rejects(runInstallAccountTransaction({
      install: async () => { calls.push("install"); fail("install") },
      bootstrap: async () => { calls.push("bootstrap"); fail("bootstrap"); return { generation: 2 } },
      cancelPreparation: () => { calls.push("cancel") },
      commit: async () => { calls.push("commit"); fail("commit") },
      publish: async () => { calls.push("publish"); fail("publish"); phase = "authenticated" },
      revokeNewSession: async () => { calls.push("revoke-new-bearer") },
      restore: async (stage) => { calls.push(`restore:${stage}`); phase = "authenticated" },
      onRestoreFailure: async () => { phase = "degraded" },
    }))
    assert.equal(phase, "authenticated")
    assert.deepEqual(calls.slice(-3), ["cancel", "revoke-new-bearer", `restore:${failed}`])
  }
})

test("failed compensation enters explicit degraded rather than retaining new identity", async () => {
  let phase = "preparing"
  await assert.rejects(runInstallAccountTransaction({
    install: async () => undefined,
    bootstrap: async () => { throw new Error("bootstrap") },
    cancelPreparation: () => undefined,
    commit: async () => undefined,
    publish: async () => undefined,
    revokeNewSession: async () => undefined,
    restore: async () => { throw new Error("secure restore") },
    onRestoreFailure: async () => { phase = "degraded" },
  }))
  assert.equal(phase, "degraded")
})

test("successful same-identity transaction performs one install/bootstrap/commit/publish", async () => {
  const calls: string[] = []
  await runInstallAccountTransaction({
    install: async () => { calls.push("upsert") },
    bootstrap: async () => { calls.push("bootstrap"); return 3 },
    cancelPreparation: () => { calls.push("unexpected-cancel") },
    commit: async () => { calls.push("cas") },
    publish: async () => { calls.push("activate") },
    revokeNewSession: async () => { calls.push("unexpected-revoke") },
    restore: async () => { calls.push("unexpected-restore") },
    onRestoreFailure: async () => undefined,
  })
  assert.deepEqual(calls, ["upsert", "bootstrap", "cas", "activate"])
})
