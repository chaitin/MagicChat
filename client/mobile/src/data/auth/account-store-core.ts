import { normalizeServerUrl } from "@/core/server-model"

export type AccountId = string

export type AccountRecord = {
  id: AccountId
  serverId: string
  url: string
  userId: string
  avatar?: string
  name: string
  email?: string
  lastUsedAt: string
  status?: "ready" | "reauth-required"
}

export type AccountIndexV2 = {
  version: 2
  accounts: AccountRecord[]
  activeAccountId: AccountId | null
  revision: number
  /** Non-sensitive retry journal for credentials deleted after an index commit. */
  pendingCredentialCleanup: AccountId[]
}

export type SessionCredential = { token: string; expiresAt: string }
export type AccountProfileMetadata = { avatar: string; email: string; name: string }

export type CredentialResult =
  | { status: "valid"; credential: SessionCredential }
  | { status: "missing" | "corrupt" | "expired" }

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface SecureKeyValueStore extends KeyValueStore {
  deleteItem(key: string): Promise<void>
}

export type AccountStore = ReturnType<typeof createAccountStore>

export const ACCOUNT_INDEX_STORAGE_KEY = "@magicchat/account-index/v2"
export const ACCOUNT_CREDENTIAL_KEY_PREFIX = "magicchat.session.v2."

const EMPTY_INDEX: AccountIndexV2 = {
  version: 2,
  accounts: [],
  activeAccountId: null,
  revision: 0,
  pendingCredentialCleanup: [],
}

const storeWriteQueues = new WeakMap<KeyValueStore, Promise<unknown>>()

export class AccountRevisionConflictError extends Error {
  constructor() {
    super("账号索引已被其他操作更新")
    this.name = "AccountRevisionConflictError"
  }
}

export function createAccountId(url: string, userId: string): AccountId {
  const normalizedUrl = normalizeServerUrl(url)
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error("用户标识不能为空")
  return `account_v2_${utf8Hex(`${normalizedUrl}\n${normalizedUserId}`)}`
}

export function createAccountRecord(
  input: Omit<AccountRecord, "id" | "url"> & { url: string }
): AccountRecord {
  const url = normalizeServerUrl(input.url)
  const userId = input.userId.trim()
  return { ...input, id: createAccountId(url, userId), url, userId }
}

export function createCredentialStorageKey(accountId: AccountId) {
  if (!/^account_v2_[0-9a-f]+$/.test(accountId)) {
    throw new Error("账号标识格式无效")
  }
  return `${ACCOUNT_CREDENTIAL_KEY_PREFIX}${accountId}`
}

export function parseAccountIndex(value: string | null): AccountIndexV2 | null {
  if (!value) return { ...EMPTY_INDEX, accounts: [], pendingCredentialCleanup: [] }
  try {
    const candidate: unknown = JSON.parse(value)
    if (!isObject(candidate) || candidate.version !== 2 ||
      !Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0 ||
      !Array.isArray(candidate.accounts) ||
      !(candidate.activeAccountId === null || typeof candidate.activeAccountId === "string") ||
      !(candidate.pendingCredentialCleanup === undefined || Array.isArray(candidate.pendingCredentialCleanup))) return null

    const accounts = candidate.accounts.map(parseAccountRecord)
    if (accounts.some((item) => item === null)) return null
    const records = accounts as AccountRecord[]
    if (new Set(records.map((item) => item.id)).size !== records.length) return null
    const ids = new Set(records.map((item) => item.id))
    if (candidate.activeAccountId !== null && !ids.has(candidate.activeAccountId as string)) return null
    const pending = candidate.pendingCredentialCleanup ?? []
    if (pending.some((item: unknown) => typeof item !== "string" || !/^account_v2_[0-9a-f]+$/.test(item))) return null
    return {
      version: 2,
      accounts: records,
      activeAccountId: candidate.activeAccountId as AccountId | null,
      revision: candidate.revision as number,
      pendingCredentialCleanup: [...new Set(pending as AccountId[])],
    }
  } catch {
    return null
  }
}

export function parseCredential(value: string | null, now = Date.now()): CredentialResult {
  if (value === null) return { status: "missing" }
  try {
    const candidate: unknown = JSON.parse(value)
    if (!isObject(candidate) || typeof candidate.token !== "string" || !candidate.token ||
      typeof candidate.expiresAt !== "string") return { status: "corrupt" }
    const expiry = Date.parse(candidate.expiresAt)
    if (!Number.isFinite(expiry)) return { status: "corrupt" }
    if (expiry <= now) return { status: "expired" }
    return { status: "valid", credential: { token: candidate.token, expiresAt: candidate.expiresAt } }
  } catch {
    return { status: "corrupt" }
  }
}

export function createAccountStore(options: {
  indexStore: KeyValueStore
  credentialStore: SecureKeyValueStore
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const queue = storeWriteQueues.get(options.indexStore) ?? Promise.resolve()
    const result = queue.then(operation, operation)
    storeWriteQueues.set(
      options.indexStore,
      result.then(() => undefined, () => undefined)
    )
    return result
  }
  const readIndex = async () => {
    const parsed = parseAccountIndex(
      await options.indexStore.getItem(ACCOUNT_INDEX_STORAGE_KEY)
    )
    if (!parsed) throw new Error("账号索引损坏")
    return cloneIndex(parsed)
  }
  const writeIndex = async (index: AccountIndexV2) => {
    await options.indexStore.setItem(
      ACCOUNT_INDEX_STORAGE_KEY,
      JSON.stringify(index)
    )
  }
  const credential = async (id: AccountId) =>
    parseCredential(await options.credentialStore.getItem(createCredentialStorageKey(id)), now())

  return {
    hydrate: () => serialized(async () => {
      let index = await readIndex()
      let changed = false
      const remainingCleanup: AccountId[] = []
      for (const id of index.pendingCredentialCleanup) {
        if (index.accounts.some((account) => account.id === id)) {
          changed = true
          continue
        }
        try { await options.credentialStore.deleteItem(createCredentialStorageKey(id)); changed = true }
        catch { remainingCleanup.push(id) }
      }
      const accounts: AccountRecord[] = []
      for (const account of index.accounts) {
        const expectedId = createAccountId(account.url, account.userId)
        if (expectedId !== account.id) throw new Error("账号索引身份不一致")
        const result = await credential(account.id)
        const status = result.status === "valid" ? "ready" : "reauth-required"
        accounts.push(account.status === status ? account : { ...account, status })
        changed ||= account.status !== status
      }
      const active = index.activeAccountId && accounts.find((a) => a.id === index.activeAccountId && a.status === "ready")
        ? index.activeAccountId : null
      changed ||= active !== index.activeAccountId || remainingCleanup.length !== index.pendingCredentialCleanup.length
      if (changed) {
        index = { ...index, accounts, activeAccountId: active, pendingCredentialCleanup: remainingCleanup, revision: index.revision + 1 }
        await writeIndex(index)
      }
      return cloneIndex(index)
    }),

    getCredential: (accountId: AccountId) => serialized(() => credential(accountId)),

    updateAccountProfile: (accountId: AccountId, profile: AccountProfileMetadata) => serialized(async () => {
      const index = await readIndex()
      const position = index.accounts.findIndex((account) => account.id === accountId)
      if (position < 0) throw new Error("账号不存在")
      const account = index.accounts[position]!
      if (account.avatar === profile.avatar && account.email === profile.email && account.name === profile.name) return cloneIndex(index)
      const accounts = [...index.accounts]
      accounts[position] = { ...account, avatar: profile.avatar, email: profile.email, name: profile.name }
      const next = { ...index, accounts, revision: index.revision + 1 }
      await writeIndex(next)
      return cloneIndex(next)
    }),

    /** Imports non-secret legacy identity only. It never writes SecureStore. */
    importReauthRequired: (record: AccountRecord) => serialized(async () => {
      const normalized = createAccountRecord({
        serverId: record.serverId, url: record.url, userId: record.userId,
        avatar: record.avatar, name: record.name, email: record.email, lastUsedAt: record.lastUsedAt,
        status: "reauth-required",
      })
      if (record.id !== normalized.id) throw new Error("账号标识与身份不匹配")
      const index = await readIndex()
      const position = index.accounts.findIndex((item) => item.id === record.id)
      const accounts = [...index.accounts]
      const replacement = { ...normalized, status: "reauth-required" as const }
      if (position < 0) accounts.push(replacement)
      else if (accounts[position].status === "ready") return
      else accounts[position] = replacement
      await writeIndex({ ...index, accounts, activeAccountId: null, revision: index.revision + 1 })
    }),

    installAccount: (record: AccountRecord, value: SessionCredential) => serialized(async () => {
      const normalized = createAccountRecord({
        serverId: record.serverId,
        url: record.url,
        userId: record.userId,
        avatar: record.avatar,
        name: record.name,
        email: record.email,
        lastUsedAt: record.lastUsedAt,
        status: record.status,
      })
      if (record.id !== normalized.id) throw new Error("账号标识与身份不匹配")
      if (parseCredential(JSON.stringify(value), now()).status !== "valid") throw new Error("会话凭据无效")
      let index = await readIndex()
      const key = createCredentialStorageKey(record.id)
      const oldValue = await options.credentialStore.getItem(key)
      const isNewAccount = !index.accounts.some((item) => item.id === record.id)
      if (isNewAccount) {
		const staged = { ...normalized, status: "reauth-required" as const }
        index = {
          ...index,
          accounts: [...index.accounts, staged],
          pendingCredentialCleanup: [
            ...new Set([...index.pendingCredentialCleanup, record.id]),
          ],
          revision: index.revision + 1,
        }
        await writeIndex(index)
      }
      try {
        await options.credentialStore.setItem(key, JSON.stringify(value))
      } catch (error) {
        if (isNewAccount) {
          try {
            await writeIndex({
              ...index,
              accounts: index.accounts.filter((item) => item.id !== record.id),
              pendingCredentialCleanup: index.pendingCredentialCleanup.filter(
                (id) => id !== record.id
              ),
              revision: index.revision + 1,
            })
          } catch {
            // The cleanup journal is safe to retain when no credential was written.
          }
        }
        throw error
      }
      try {
        const replacement = { ...normalized, status: "ready" as const }
        const position = index.accounts.findIndex((item) => item.id === record.id)
        const accounts = [...index.accounts]
        if (position < 0) accounts.push(replacement)
        else accounts[position] = replacement
        await writeIndex({
          ...index,
          accounts,
          pendingCredentialCleanup: index.pendingCredentialCleanup.filter(
            (id) => id !== record.id
          ),
          revision: index.revision + 1,
        })
      } catch (error) {
        if (!isNewAccount) {
          try {
            if (oldValue === null) await options.credentialStore.deleteItem(key)
            else await options.credentialStore.setItem(key, oldValue)
          } catch {
            // The account remains indexed to the same identity and is reconciled later.
          }
        }
        throw error
      }
    }),

    /** Restores a previously captured account after a failed credential replacement. */
    restoreAccount: (record: AccountRecord, value: SessionCredential | null) => serialized(async () => {
      const normalized = createAccountRecord({
        serverId: record.serverId, url: record.url, userId: record.userId,
        avatar: record.avatar, name: record.name, email: record.email, lastUsedAt: record.lastUsedAt,
        status: value ? "ready" : "reauth-required",
      })
      if (normalized.id !== record.id) throw new Error("账号标识与身份不匹配")
      const index = await readIndex()
      const key = createCredentialStorageKey(record.id)
      const oldValue = await options.credentialStore.getItem(key)
      if (value && parseCredential(JSON.stringify(value), now()).status !== "valid") throw new Error("会话凭据无效")
      try {
        if (value) await options.credentialStore.setItem(key, JSON.stringify(value))
        else await options.credentialStore.deleteItem(key)
        const replacement = { ...normalized, status: value ? "ready" as const : "reauth-required" as const }
        const accounts = [...index.accounts]
        const position = accounts.findIndex((item) => item.id === record.id)
        if (position < 0) accounts.push(replacement)
        else accounts[position] = replacement
        await writeIndex({ ...index, accounts, revision: index.revision + 1 })
      } catch (error) {
        try {
          if (oldValue === null) await options.credentialStore.deleteItem(key)
          else await options.credentialStore.setItem(key, oldValue)
        } catch { /* Hydrate reconciliation handles a later retry. */ }
        throw error
      }
    }),

    commitActive: (accountId: AccountId | null, expectedRevision: number) => serialized(async () => {
      const index = await readIndex()
      if (index.revision !== expectedRevision) throw new AccountRevisionConflictError()
      if (accountId !== null) {
        const account = index.accounts.find((item) => item.id === accountId)
        if (!account) throw new Error("账号不存在")
        if (account.status !== "ready" || (await credential(accountId)).status !== "valid") {
          throw new Error("账号需要重新登录")
        }
      }
      const next = { ...index, activeAccountId: accountId, revision: index.revision + 1 }
      await writeIndex(next)
      return next.revision
    }),

    markReauthRequired: (accountId: AccountId) => serialized(async () => {
      const index = await readIndex()
      const accounts = index.accounts.map((item) => item.id === accountId ? { ...item, status: "reauth-required" as const } : item)
      if (!accounts.some((item) => item.id === accountId)) return
      await writeIndex({ ...index, accounts, activeAccountId: index.activeAccountId === accountId ? null : index.activeAccountId, revision: index.revision + 1 })
    }),

    removeAccount: (accountId: AccountId) => serialized(async () => {
      const index = await readIndex()
      if (!index.accounts.some((item) => item.id === accountId)) return
      const next: AccountIndexV2 = {
        ...index,
        accounts: index.accounts.filter((item) => item.id !== accountId),
        activeAccountId: index.activeAccountId === accountId ? null : index.activeAccountId,
        pendingCredentialCleanup: [...new Set([...index.pendingCredentialCleanup, accountId])],
        revision: index.revision + 1,
      }
      await writeIndex(next)
      try {
        await options.credentialStore.deleteItem(createCredentialStorageKey(accountId))
        await writeIndex({ ...next, pendingCredentialCleanup: next.pendingCredentialCleanup.filter((id) => id !== accountId), revision: next.revision + 1 })
      } catch { /* Journal remains for hydrate retry; removal itself is committed. */ }
    }),
  }
}

function parseAccountRecord(value: unknown): AccountRecord | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.serverId !== "string" ||
    typeof value.url !== "string" || typeof value.userId !== "string" || typeof value.name !== "string" ||
    typeof value.lastUsedAt !== "string" || (value.avatar !== undefined && typeof value.avatar !== "string") ||
    (value.email !== undefined && typeof value.email !== "string") ||
    (value.status !== undefined && value.status !== "ready" && value.status !== "reauth-required")) return null
  try {
    if (createAccountId(value.url, value.userId) !== value.id || normalizeServerUrl(value.url) !== value.url || !Number.isFinite(Date.parse(value.lastUsedAt))) return null
  } catch { return null }
  return value as AccountRecord
}
function cloneIndex(index: AccountIndexV2): AccountIndexV2 { return { ...index, accounts: index.accounts.map((a) => ({ ...a })), pendingCredentialCleanup: [...index.pendingCredentialCleanup] } }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null }
function utf8Hex(value: string) { return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("") }
