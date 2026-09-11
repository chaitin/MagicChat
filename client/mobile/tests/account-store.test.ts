import assert from "node:assert/strict"
import test from "node:test"

import {
  ACCOUNT_INDEX_STORAGE_KEY,
  AccountRevisionConflictError,
  createAccountId,
  createAccountRecord,
  createAccountStore,
  createCredentialStorageKey,
  parseAccountIndex,
  parseCredential,
  type KeyValueStore,
  type SecureKeyValueStore,
} from "../src/data/auth/account-store.ts"

class MemoryStore implements SecureKeyValueStore {
  values = new Map<string, string>()
  failGet = 0
  failSet = 0
  failDelete = 0
  failSetOn = 0
  setCalls = 0
  async getItem(key: string) { if (this.failGet-- > 0) throw new Error("read failed"); return this.values.get(key) ?? null }
  async setItem(key: string, value: string) {
    this.setCalls++
    if (this.failSet-- > 0 || this.setCalls === this.failSetOn) throw new Error("write failed")
    this.values.set(key, value)
  }
  async deleteItem(key: string) { if (this.failDelete-- > 0) throw new Error("delete failed"); this.values.delete(key) }
}

const future = "2099-01-01T00:00:00.000Z"
const token = "SENSITIVE_TEST_VALUE"
function record(url = "https://example.com", userId = "user-a", serverId = "display-a") {
  return createAccountRecord({ serverId, url, userId, name: "A", email: "a@example.com", lastUsedAt: "2026-01-01T00:00:00Z" })
}
function fixture() {
  const index = new MemoryStore()
  const secure = new MemoryStore()
  return { index, secure, store: createAccountStore({ indexStore: index, credentialStore: secure, now: () => Date.parse("2026-01-01T00:00:00Z") }) }
}

test("account id is normalized, collision-free, server-display-id independent and SecureStore-safe", () => {
  assert.equal(createAccountId(" HTTPS://EXAMPLE.COM:443/path///?x=1#x ", "u"), createAccountId("https://example.com/path", "u"))
  assert.equal(record("https://example.com", "u", "old").id, record("https://example.com/", "u", "new").id)
  assert.notEqual(createAccountId("https://example.com", "a"), createAccountId("https://example.com", "b"))
  assert.notEqual(createAccountId("https://example.com", "a"), createAccountId("https://other.example.com", "a"))
  assert.match(createCredentialStorageKey(record().id), /^[A-Za-z0-9._-]+$/)
})

test("strict index and credential parsing covers schema version and invalid values", () => {
  assert.equal(parseAccountIndex('{"version":1}'), null)
  assert.equal(parseAccountIndex("broken"), null)
  assert.equal(parseCredential(null).status, "missing")
  assert.equal(parseCredential("broken").status, "corrupt")
  assert.equal(parseCredential('{"token":"x","expiresAt":"bad"}').status, "corrupt")
  assert.equal(parseCredential('{"token":"x","expiresAt":"2020-01-01T00:00:00Z"}').status, "expired")
})

test("install/upsert stores only metadata in AsyncStorage and replaces same identity", async () => {
  const { store, index, secure } = fixture()
  const first = record()
  await store.installAccount(first, { token, expiresAt: future })
  await store.installAccount({ ...first, avatar: "/avatars/user.webp", serverId: "renamed", name: "Renamed" }, { token: `${token}_NEW`, expiresAt: future })
  const hydrated = await store.hydrate()
  assert.equal(hydrated.accounts.length, 1)
  assert.equal(hydrated.accounts[0]?.avatar, "/avatars/user.webp")
  assert.equal(hydrated.accounts[0]?.serverId, "renamed")
  assert.equal(index.values.get(ACCOUNT_INDEX_STORAGE_KEY)?.includes(token), false)
  assert.equal([...secure.values.values()].some((value) => value.includes(token)), true)
  assert.equal(JSON.stringify(hydrated).includes(token), false)
})

test("profile metadata refresh persists avatar without touching credentials", async () => {
  const { store, index } = fixture()
  const account = record()
  await store.installAccount(account, { token, expiresAt: future })
  const before = await store.hydrate()
  const updated = await store.updateAccountProfile(account.id, {
    avatar: "/avatars/user.webp",
    email: "updated@example.com",
    name: "Updated",
  })
  assert.equal(updated.accounts[0]?.avatar, "/avatars/user.webp")
  assert.equal(updated.accounts[0]?.email, "updated@example.com")
  assert.equal(updated.revision, before.revision + 1)
  assert.equal(index.values.get(ACCOUNT_INDEX_STORAGE_KEY)?.includes(token), false)
  const unchanged = await store.updateAccountProfile(account.id, {
    avatar: "/avatars/user.webp",
    email: "updated@example.com",
    name: "Updated",
  })
  assert.equal(unchanged.revision, updated.revision)
})

test("active account commit uses revision CAS and maintains one active id", async () => {
  const { store } = fixture()
  const a = record()
  const b = record("https://other.example.com", "user-b")
  await store.installAccount(a, { token, expiresAt: future })
  await store.installAccount(b, { token, expiresAt: future })
  const before = await store.hydrate()
  const revision = await store.commitActive(a.id, before.revision)
  await assert.rejects(store.commitActive(b.id, before.revision), AccountRevisionConflictError)
  const after = await store.hydrate()
  assert.equal(after.activeAccountId, a.id)
  assert.equal(after.revision, revision)
})

test("hydrate marks missing/corrupt/expired credentials and clears invalid active", async () => {
  for (const value of [null, "broken", JSON.stringify({ token, expiresAt: "2020-01-01T00:00:00Z" })]) {
    const { store, secure } = fixture()
    const account = record()
    await store.installAccount(account, { token, expiresAt: future })
    const revision = (await store.hydrate()).revision
    await store.commitActive(account.id, revision)
    const key = createCredentialStorageKey(account.id)
    if (value === null) secure.values.delete(key); else secure.values.set(key, value)
    const result = await store.hydrate()
    assert.equal(result.accounts[0]?.status, "reauth-required")
    assert.equal(result.activeAccountId, null)
    assert.notEqual((await store.getCredential(account.id)).status, "valid")
  }
})

test("SecureStore write failure leaves index unchanged; index failure restores old credential", async () => {
  const { store, index, secure } = fixture()
  const account = record()
  secure.failSet = 1
  await assert.rejects(store.installAccount(account, { token, expiresAt: future }), /write failed/)
  assert.deepEqual(parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)?.accounts, [])
  assert.deepEqual(parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)?.pendingCredentialCleanup, [])

  await store.installAccount(account, { token: "OLD_VALUE", expiresAt: future })
  index.failSet = 1
  await assert.rejects(store.installAccount({ ...account, name: "new" }, { token, expiresAt: future }), /write failed/)
  const restored = await store.getCredential(account.id)
  assert.equal(restored.status, "valid")
  if (restored.status === "valid") assert.equal(restored.credential.token, "OLD_VALUE")
})

test("failed same-identity replacement can restore old record and credential without duplicates", async () => {
  const { store } = fixture()
  const account = record()
  await store.installAccount(account, { token: "OLD_VALUE", expiresAt: future })
  const oldRecord = (await store.hydrate()).accounts[0]!
  await store.installAccount({ ...account, name: "New name" }, { token: "NEW_VALUE", expiresAt: future })
  await store.restoreAccount(oldRecord, { token: "OLD_VALUE", expiresAt: future })
  const restored = await store.hydrate()
  assert.equal(restored.accounts.length, 1)
  assert.equal(restored.accounts[0]?.name, oldRecord.name)
  const credential = await store.getCredential(account.id)
  assert.equal(credential.status === "valid" ? credential.credential.token : null, "OLD_VALUE")
})

test("restoreAccount rolls SecureStore back when its index commit fails", async () => {
  const { store, index } = fixture()
  const account = record()
  await store.installAccount(account, { token: "NEW_VALUE", expiresAt: future })
  index.failSet = 1
  await assert.rejects(store.restoreAccount({ ...account, name: "Old" }, { token: "OLD_VALUE", expiresAt: future }), /write failed/)
  const credential = await store.getCredential(account.id)
  assert.equal(credential.status === "valid" ? credential.credential.token : null, "NEW_VALUE")
  assert.equal((await store.hydrate()).accounts[0]?.name, account.name)
})

test("restoreAccount preserves index when SecureStore set/delete fails", async () => {
  for (const withCredential of [true, false]) {
    const { store, secure } = fixture()
    const account = record()
    await store.installAccount(account, { token: "NEW_VALUE", expiresAt: future })
    if (withCredential) secure.failSet = 1
    else secure.failDelete = 1
    await assert.rejects(store.restoreAccount({ ...account, name: "Old" }, withCredential ? { token: "OLD_VALUE", expiresAt: future } : null))
    assert.equal((await store.hydrate()).accounts[0]?.name, account.name)
  }
})

test("failed final index commit is reconciled as ready without deleting the credential", async () => {
  const { store, index, secure } = fixture()
  const account = record()
  index.failSetOn = 2
  let message = ""
  try { await store.installAccount(account, { token, expiresAt: future }) } catch (error) { message = String(error) }
  assert.equal(message.includes(token), false)
  assert.equal([...index.values.values()].some((value) => value.includes(token)), false)
  assert.deepEqual(parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)?.pendingCredentialCleanup, [account.id])
  const recovered = await store.hydrate()
  assert.equal(secure.values.has(createCredentialStorageKey(account.id)), true)
  assert.equal(recovered.accounts[0]?.status, "ready")
  assert.deepEqual(recovered.pendingCredentialCleanup, [])
})

test("remove commits index first, journals failed deletion, and hydrate retries cleanup", async () => {
  const { store, index, secure } = fixture()
  const account = record()
  await store.installAccount(account, { token, expiresAt: future })
  secure.failDelete = 1
  await store.removeAccount(account.id)
  let persisted = parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)
  assert.deepEqual(persisted?.accounts, [])
  assert.deepEqual(persisted?.pendingCredentialCleanup, [account.id])
  await store.hydrate()
  persisted = parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)
  assert.deepEqual(persisted?.pendingCredentialCleanup, [])
  assert.equal(secure.values.has(createCredentialStorageKey(account.id)), false)
})

test("index write failure during remove preserves account and credential", async () => {
  const { store, index, secure } = fixture()
  const account = record()
  await store.installAccount(account, { token, expiresAt: future })
  index.failSet = 1
  await assert.rejects(store.removeAccount(account.id), /write failed/)
  assert.equal((await store.hydrate()).accounts.length, 1)
  assert.equal(secure.values.has(createCredentialStorageKey(account.id)), true)
})

test("reinstall clears a pending deletion journal before the next hydrate", async () => {
  const { store, index, secure } = fixture()
  const account = record()
  await store.installAccount(account, { token: "OLD_VALUE", expiresAt: future })
  secure.failDelete = 1
  await store.removeAccount(account.id)
  await store.installAccount(account, { token, expiresAt: future })
  const persisted = parseAccountIndex(index.values.get(ACCOUNT_INDEX_STORAGE_KEY) ?? null)
  assert.deepEqual(persisted?.pendingCredentialCleanup, [])
  assert.equal((await store.hydrate()).accounts[0]?.status, "ready")
  assert.equal((await store.getCredential(account.id)).status, "valid")
})

test("shared adapters serialize independent AccountStore instances without losing updates", async () => {
  const index = new MemoryStore()
  const secure = new MemoryStore()
  const first = createAccountStore({ indexStore: index, credentialStore: secure })
  const second = createAccountStore({ indexStore: index, credentialStore: secure })
  await Promise.all([
    first.installAccount(record(), { token, expiresAt: future }),
    second.installAccount(record("https://other.example.com", "u2"), { token, expiresAt: future }),
  ])
  assert.equal((await first.hydrate()).accounts.length, 2)
})

test("active commit rejects accounts without a valid ready credential", async () => {
  const { store, secure } = fixture()
  const account = record()
  await store.installAccount(account, { token, expiresAt: future })
  secure.values.delete(createCredentialStorageKey(account.id))
  const hydrated = await store.hydrate()
  await assert.rejects(
    store.commitActive(account.id, hydrated.revision),
    /重新登录/
  )
})

test("operations are serialized in process", async () => {
  const backing = new MemoryStore()
  let concurrent = 0
  let peak = 0
  const index: KeyValueStore = {
    getItem: (key) => backing.getItem(key),
    setItem: async (key, value) => { concurrent++; peak = Math.max(peak, concurrent); await new Promise((resolve) => setTimeout(resolve, 5)); await backing.setItem(key, value); concurrent-- },
  }
  const secure = new MemoryStore()
  const store = createAccountStore({ indexStore: index, credentialStore: secure })
  await Promise.all([
    store.installAccount(record(), { token, expiresAt: future }),
    store.installAccount(record("https://other.example.com", "u2"), { token, expiresAt: future }),
  ])
  assert.equal(peak, 1)
  assert.equal((await store.hydrate()).accounts.length, 2)
})
