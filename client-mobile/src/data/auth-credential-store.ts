import * as SecureStore from "expo-secure-store"

import type { ServerTarget } from "@/data/query"

type StoredLoginCredentials = {
  account: string
  password: string
  serverId: string
  serverUrl: string
}

const CREDENTIAL_KEY_PREFIX = "magicchat.credentials.v1"
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
    account: credentials.account,
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
