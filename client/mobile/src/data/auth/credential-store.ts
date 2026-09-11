import * as SecureStore from "expo-secure-store"

import type { ServerTarget } from "@/core/server-target"

export type LoginAccountAssistance = {
  accountId: string
  account: string
  serverId: string
  serverUrl: string
}

type StoredLoginCredentials = {
  account: string
  password: string
  serverId: string
  serverUrl: string
}

const CREDENTIAL_KEY_PREFIX = "magicchat.credentials.v1"
const ACCOUNT_ASSISTANCE_KEY_PREFIX = "magicchat.login-account.v2"
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export async function loadLoginCredentials(
  server: ServerTarget
): Promise<Pick<StoredLoginCredentials, "account" | "password"> | null> {
  if (!(await SecureStore.isAvailableAsync())) {
    return null
  }

  const storedValue = await SecureStore.getItemAsync(
    createCredentialKey(server),
    secureStoreOptions
  )
  const credentials = parseStoredCredentials(storedValue)

  if (
    !credentials ||
    credentials.serverId !== server.id ||
    credentials.serverUrl !== server.url
  ) {
    return null
  }

  return {
    account: credentials.account,
    password: credentials.password,
  }
}

export async function saveLoginCredentials(
  server: ServerTarget,
  credentials: { account: string; password: string }
) {
  if (!(await SecureStore.isAvailableAsync())) {
    return
  }

  const storedCredentials: StoredLoginCredentials = {
    account: credentials.account.trim(),
    password: credentials.password,
    serverId: server.id,
    serverUrl: server.url,
  }

  await SecureStore.setItemAsync(
    createCredentialKey(server),
    JSON.stringify(storedCredentials),
    secureStoreOptions
  )
}

// New multi-account callers use this password-free, accountId-scoped form assistance.
// Legacy APIs remain available until the login UI moves in a later task.
export async function saveAccountLoginAssistance(value: LoginAccountAssistance) {
  if (!(await SecureStore.isAvailableAsync())) return
  await SecureStore.setItemAsync(
    `${ACCOUNT_ASSISTANCE_KEY_PREFIX}.${value.accountId}`,
    JSON.stringify({ ...value, account: value.account.trim() }),
    secureStoreOptions
  )
}

export async function loadAccountLoginAssistance(accountId: string): Promise<LoginAccountAssistance | null> {
  if (!(await SecureStore.isAvailableAsync())) return null
  const raw = await SecureStore.getItemAsync(`${ACCOUNT_ASSISTANCE_KEY_PREFIX}.${accountId}`, secureStoreOptions)
  try {
    const value: unknown = raw && JSON.parse(raw)
    if (!isRecord(value) || value.accountId !== accountId || typeof value.account !== "string" ||
      typeof value.serverId !== "string" || typeof value.serverUrl !== "string") return null
    return value as LoginAccountAssistance
  } catch { return null }
}

export async function saveLoginAccount(server: ServerTarget, account: string) {
  const normalizedAccount = account.trim()
  const existingCredentials = await loadLoginCredentials(server)
  const password =
    existingCredentials?.account === normalizedAccount
      ? existingCredentials.password
      : ""

  await saveLoginCredentials(server, {
    account: normalizedAccount,
    password,
  })
}

export async function migrateLegacyLoginAssistance(
  server: ServerTarget,
  accountId: string
): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) return
  const legacyKey = createCredentialKey(server)
  const legacy = parseStoredCredentials(await SecureStore.getItemAsync(legacyKey, secureStoreOptions))
  if (legacy?.account) {
    await saveAccountLoginAssistance({
      accountId, account: legacy.account, serverId: server.id, serverUrl: server.url,
    })
  }
  // Passwords are intentionally discarded; they are never Session credentials.
  await SecureStore.deleteItemAsync(legacyKey, secureStoreOptions)
}

function createCredentialKey(server: ServerTarget) {
  return `${CREDENTIAL_KEY_PREFIX}.${hashString(`${server.id}\n${server.url}`)}`
}

function hashString(value: string) {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, "0")
}

function parseStoredCredentials(value: string | null): StoredLoginCredentials | null {
  if (!value) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (
      !isRecord(parsed) ||
      typeof parsed.account !== "string" ||
      typeof parsed.password !== "string" ||
      typeof parsed.serverId !== "string" ||
      typeof parsed.serverUrl !== "string"
    ) {
      return null
    }

    return {
      account: parsed.account,
      password: parsed.password,
      serverId: parsed.serverId,
      serverUrl: parsed.serverUrl,
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
