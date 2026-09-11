import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { createAccountId } from "@/data/auth/account-store"
import { installAccountAuthRuntime } from "@/data/auth/account-runtime-registry"
import { revokePrivatePushGrant } from "@/notifications/push-private-server-api"
import { hasActiveRemotePushDelegation, setActiveRemotePushTarget, setCurrentPushIdentity } from "@/notifications/push-runtime-state"
import { parsePendingPushRevocationQueue } from "@/notifications/push-types"
import { createPushRevocationQueueStore } from "@/notifications/push-revocation-queue-store"

const a = { id: "server", url: "https://a.example.com", userId: "a" }
const b = { id: "server", url: "https://b.example.com", userId: "b" }
const accountA = createAccountId(a.url, a.userId)
const accountB = createAccountId(b.url, b.userId)

test("revocation queue model contains only non-secret account/target references", async () => {
  const raw = JSON.stringify([{ accountId: accountA, grantId: "grant", installationId: "installation",
    privateRevoked: false, queuedAt: "2026-01-01T00:00:00Z", target: a }])
  const parsed = parsePendingPushRevocationQueue(JSON.parse(raw))
  assert.equal(parsed?.length, 1)
  assert.doesNotMatch(raw, /authorization|bearer|session.?token|sendToken|managementToken/i)
  const storeSource = await readFile(new URL("../src/notifications/push-revocation-queue-store.ts", import.meta.url), "utf8")
  assert.match(storeSource, /PENDING_REVOCATION_KEY/)
  assert.doesNotMatch(storeSource, /authorization|bearer|session.?token|sendToken|managementToken/i)
})

test("AsyncStorage queue set failure is observable and retains no false durable entry", async () => {
  let persisted: string | null = null
  const queue = createPushRevocationQueueStore({
    getItem: async () => persisted,
    removeItem: async () => { persisted = null },
    setItem: async () => { throw new Error("AsyncStorage set failed") },
  })
  await assert.rejects(queue.enqueue({ accountId: accountA, grantId: "grant", installationId: "installation",
    queuedAt: "2026-01-01T00:00:00Z", target: a }), /set failed/)
  assert.equal(persisted, null)
})

test("logout carries installation revocation before AccountStore credential deletion", async () => {
  const source = await readFile(new URL("../src/providers/auth-provider.tsx", import.meta.url), "utf8")
  const logoutAt = source.indexOf("await logout(account.url")
  const queueAt = source.indexOf("queueRevocation(pushIdentity, true)", logoutAt)
  const removeAt = source.indexOf("accountStore.removeAccount(accountId)", queueAt)
  assert.ok(logoutAt >= 0 && queueAt > logoutAt && removeAt > queueAt)
})

test("inactive revocation resolves that account credential and never falls back active token", async () => {
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: {
    token: id === accountB ? "token-B" : "token-A", expiresAt: "2099-01-01T00:00:00Z" } }) })
  runtime.install({ accountId: accountA, generation: 3, target: a })
  installAccountAuthRuntime(runtime)
  let authorization = ""
  await revokePrivatePushGrant(b, accountB, "installation-B", "grant-B", { fetcher: async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? ""
    return Response.json({ success: true, data: {} })
  } })
  assert.equal(authorization, "Bearer token-B")
})

test("inactive revocation 401 is isolated from active runtime", async () => {
  const marked: string[] = []
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: {
    token: `token-${id}`, expiresAt: "2099-01-01T00:00:00Z" } }) })
  runtime.install({ accountId: accountA, generation: 3, target: a })
  runtime.setUnauthorizedHandler(async (id) => { marked.push(id) })
  installAccountAuthRuntime(runtime)
  await assert.rejects(revokePrivatePushGrant(b, accountB, "installation-B", "grant-B", { fetcher: async () =>
    Response.json({ success: false }, { status: 401 }) }))
  assert.deepEqual(marked, [])
  assert.equal(runtime.isCurrent({ accountId: accountA, generation: 3 }), true)
})

test("push runtime requires exact account generation and target", () => {
  const identity = { accountId: accountA, generation: 7, target: a }
  setCurrentPushIdentity(identity)
  setActiveRemotePushTarget(identity)
  assert.equal(hasActiveRemotePushDelegation(identity), true)
  assert.equal(hasActiveRemotePushDelegation({ ...identity, generation: 6 }), false)
  assert.equal(hasActiveRemotePushDelegation({ ...identity, accountId: accountB, target: b }), false)
  setActiveRemotePushTarget(null)
  setCurrentPushIdentity(null)
})
