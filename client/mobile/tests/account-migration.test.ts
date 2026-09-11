import assert from "node:assert/strict"
import test from "node:test"
import { createAccountStore, type SecureKeyValueStore } from "../src/data/auth/account-store.ts"
import { ACCOUNT_MIGRATION_MARKER_KEY, LEGACY_AUTH_SESSION_KEY, migrateLegacyAccount } from "../src/data/auth/account-migration.ts"

class Memory implements SecureKeyValueStore {
  values = new Map<string, string>(); failSetOn = 0; failRemoveOn = 0; sets = 0; removes = 0
  async getItem(k: string) { return this.values.get(k) ?? null }
  async setItem(k: string, v: string) { if (++this.sets === this.failSetOn) throw new Error("set"); this.values.set(k, v) }
  async deleteItem(k: string) { this.values.delete(k) }
  async removeItem(k: string) { if (++this.removes === this.failRemoveOn) throw new Error("remove"); this.values.delete(k) }
}
function fixture(raw?: string) {
  const storage = new Memory(), secure = new Memory()
  if (raw !== undefined) storage.values.set(LEGACY_AUTH_SESSION_KEY, raw)
  const accountStore = createAccountStore({ indexStore: storage, credentialStore: secure })
  const assistance: unknown[] = []
  const run = () => migrateLegacyAccount({ storage, accountStore, now: () => new Date("2026-01-01Z"),
    migrateLoginAssistance: async (target, account) => { assistance.push({ target, account }) } })
  return { storage, secure, accountStore, assistance, run }
}
const valid = JSON.stringify({ id: "server", url: "https://example.com/", userId: "user" })

test("migration: no legacy value and corrupt value converge without exposing source", async () => {
  for (const raw of [undefined, "SECRET malformed value"]) {
    const f = fixture(raw); const result = await f.run()
    assert.equal((await f.accountStore.hydrate()).accounts.length, 0)
    assert.equal(f.storage.values.has(LEGACY_AUTH_SESSION_KEY), false)
    assert.equal(JSON.stringify(result).includes("SECRET"), false)
  }
})

test("migration imports valid identity as inactive reauth metadata without Session credential", async () => {
  const f = fixture(valid); await f.run(); const index = await f.accountStore.hydrate()
  assert.equal(index.accounts.length, 1); assert.equal(index.accounts[0]?.status, "reauth-required")
  assert.equal(index.activeAccountId, null); assert.equal((await f.accountStore.getCredential(index.accounts[0]!.id)).status, "missing")
  assert.equal(f.secure.values.size, 0); assert.equal(f.assistance.length, 1)
})

test("migration is idempotent for completed and existing same identity", async () => {
  const f = fixture(valid); await f.run(); f.storage.values.set(LEGACY_AUTH_SESSION_KEY, valid); await f.run()
  assert.equal((await f.accountStore.hydrate()).accounts.length, 1)
  assert.equal(f.assistance.length, 1)
})

test("migration recovers from every marker/delete interruption", async () => {
  for (const failSetOn of [2, 3]) { // account index is set #1, then indexed and complete markers
    const f = fixture(valid); f.storage.failSetOn = failSetOn
    await assert.rejects(f.run()); f.storage.failSetOn = 0; await f.run()
    const index = await f.accountStore.hydrate(); assert.equal(index.accounts.length, 1); assert.equal(index.activeAccountId, null)
  }
  const f = fixture(valid); f.storage.failRemoveOn = 1
  await assert.rejects(f.run()); assert.match(f.storage.values.get(ACCOUNT_MIGRATION_MARKER_KEY)!, /complete/)
  f.storage.failRemoveOn = 0; await f.run(); assert.equal(f.storage.values.has(LEGACY_AUTH_SESSION_KEY), false)
})

test("migration boundary has no cache cleanup dependency and never treats assistance password as token", async () => {
  const source = JSON.stringify({ id: "s", url: "https://example.com", userId: "u", password: "DO_NOT_LEAK" })
  const f = fixture(source); await f.run()
  assert.equal(JSON.stringify([...f.storage.values, ...f.secure.values]).includes("DO_NOT_LEAK"), false)
  assert.equal(f.secure.values.size, 0) // no SQLite/cache object is accepted by the migration API
})
