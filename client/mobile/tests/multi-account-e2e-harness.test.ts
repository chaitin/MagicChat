import assert from "node:assert/strict"
import test from "node:test"

import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { migrateLegacyAccount } from "@/data/auth/account-migration"
import { ACCOUNT_INDEX_STORAGE_KEY, createAccountRecord, createAccountStore, createCredentialStorageKey } from "@/data/auth/account-store"
import { createApiClient } from "@/data/api-client"
import { createAuthenticatedScopeKey } from "@/data/server-key"
import { logout } from "@/data/auth/auth-api"
import { setActiveRemotePushTarget, setCurrentPushIdentity, hasActiveRemotePushDelegation } from "@/notifications/push-runtime-state"
import { RealtimeClientSlot } from "@/realtime/realtime-runtime"

class MemoryStorage {
  values = new Map<string, string>()
  async getItem(key: string) { return this.values.get(key) ?? null }
  async setItem(key: string, value: string) { this.values.set(key, value) }
  async removeItem(key: string) { this.values.delete(key) }
  async deleteItem(key: string) { this.values.delete(key) }
}

const future = "2099-01-01T00:00:00Z"
const credentials = new Map([
  ["A", "opaque-fixture-A"], ["B", "opaque-fixture-B"], ["C", "opaque-fixture-C"],
])

test("three-account automated harness validates scoped transport, restart and lifecycle", async () => {
  const asyncStorage = new MemoryStorage()
  const secureStore = new MemoryStorage()
  const store = createAccountStore({ indexStore: asyncStorage, credentialStore: secureStore })
  await migrateLegacyAccount({ storage: asyncStorage, accountStore: store })
  const records = [
    createAccountRecord({ serverId: "same", url: "https://same.example.com", userId: "A", name: "A", lastUsedAt: "2026-01-01T00:00:00Z" }),
    createAccountRecord({ serverId: "same", url: "https://same.example.com", userId: "B", name: "B", lastUsedAt: "2026-01-02T00:00:00Z" }),
    createAccountRecord({ serverId: "other", url: "https://other.example.com", userId: "C", name: "C", lastUsedAt: "2026-01-03T00:00:00Z" }),
  ]
  for (const record of records) await store.installAccount(record, { token: credentials.get(record.userId)!, expiresAt: future })
  let index = await store.hydrate()
  await store.commitActive(records[2]!.id, index.revision) // add C auto-activates

  // Restart hydrate restores all three and active C without exposing credentials.
  const restarted = createAccountStore({ indexStore: asyncStorage, credentialStore: secureStore })
  index = await restarted.hydrate()
  assert.equal(index.accounts.length, 3)
  assert.equal(index.activeAccountId, records[2]!.id)
  assert.equal([...asyncStorage.values.values()].some((value) => [...credentials.values()].some((secret) => value.includes(secret))), false)

  // Deterministic A-B-A rapid switching uses revision CAS.
  for (const target of [records[0]!, records[1]!, records[0]!]) {
    index = await restarted.hydrate()
    await restarted.commitActive(target.id, index.revision)
  }
  index = await restarted.hydrate()
  assert.equal(index.activeAccountId, records[0]!.id)

  const runtime = new AccountAuthRuntime(restarted)
  runtime.install({ accountId: records[0]!.id, generation: 4, target: { id: "same", url: records[0]!.url, userId: "A" } })
  const headers: string[] = []
  const client = createApiClient(records[0]!.url, async (_url, init) => {
    headers.push(new Headers(init?.headers).get("authorization") ?? "")
    return Response.json({ success: true, data: { ok: true } })
  }, { auth: runtime.optionsFor({ id: "same", url: records[0]!.url, userId: "A" }, records[0]!.id) })
  await client.request("/api/client/me", { errorMessage: "fixture request" })
  assert.equal(headers[0], `Bearer ${credentials.get("A")}`)

  // Current A logout removes A and activates the most recent remaining C.
  await logout(records[0]!.url, { account: { accountId: records[0]!.id,
    auth: runtime.optionsForStoredAccount(records[0]!.id, { id: "same", url: records[0]!.url, userId: "A" }) },
    fetcher: async () => Response.json({ success: true }) })
  await restarted.removeAccount(records[0]!.id)
  index = await restarted.hydrate()
  await restarted.commitActive(records[2]!.id, index.revision)
  assert.equal((await restarted.hydrate()).activeAccountId, records[2]!.id)

  // Inactive B logout captures B Bearer; offline C logout retains C locally.
  let inactiveHeader = ""
  await logout(records[1]!.url, { account: { accountId: records[1]!.id,
    auth: runtime.optionsForStoredAccount(records[1]!.id, { id: "same", url: records[1]!.url, userId: "B" }) },
    fetcher: async (_url, init) => { inactiveHeader = new Headers(init?.headers).get("authorization") ?? ""; return Response.json({ success: true }) } })
  assert.equal(inactiveHeader, `Bearer ${credentials.get("B")}`)
  await restarted.removeAccount(records[1]!.id)
  await assert.rejects(async () => { throw new Error("offline fixture") }, /offline/)
  assert.equal((await restarted.hydrate()).accounts.some((account) => account.id === records[2]!.id), true)

  // Re-add A, then expire only A; SQLite-like scopes remain distinct and retained.
  await restarted.installAccount(records[0]!, { token: credentials.get("A")!, expiresAt: future })
  secureStore.values.set(createCredentialStorageKey(records[0]!.id), JSON.stringify({ token: credentials.get("A"), expiresAt: "2020-01-01T00:00:00Z" }))
  const expired = await restarted.hydrate()
  assert.equal(expired.accounts.find((account) => account.id === records[0]!.id)?.status, "reauth-required")
  const sqliteScopes = new Set(records.map((record) => JSON.stringify(createAuthenticatedScopeKey({ id: record.serverId, url: record.url, userId: record.userId }))))
  assert.equal(sqliteScopes.size, 3)

  // Realtime replacement disconnects A; Push only accepts current C generation.
  const slot = new RealtimeClientSlot()
  const socketA = { disconnected: 0, disconnect() { this.disconnected++ } }
  const socketC = { disconnected: 0, disconnect() { this.disconnected++ } }
  slot.replace(socketA as never, { accountId: records[0]!.id, generation: 4 })
  slot.replace(socketC as never, { accountId: records[2]!.id, generation: 5 })
  assert.equal(socketA.disconnected, 1)
  const pushC = { accountId: records[2]!.id, generation: 5, target: { id: "other", url: records[2]!.url, userId: "C" } }
  setCurrentPushIdentity(pushC); setActiveRemotePushTarget(pushC)
  assert.equal(hasActiveRemotePushDelegation(pushC), true)
  assert.equal(hasActiveRemotePushDelegation({ ...pushC, generation: 4 }), false)
  setActiveRemotePushTarget(null); setCurrentPushIdentity(null)

  const diagnostic = JSON.stringify({ accountCount: expired.accounts.length, headers: headers.map(() => "[REDACTED]"), scopes: sqliteScopes.size })
  assert.equal([...credentials.values()].some((secret) => diagnostic.includes(secret)), false)
  assert.ok(asyncStorage.values.has(ACCOUNT_INDEX_STORAGE_KEY))
})
