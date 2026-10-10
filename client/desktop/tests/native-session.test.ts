import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "electron")
      return {
        shortCircuit: true,
        url: `data:text/javascript,export const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => globalThis.__testStorageBackend ?? "secure",
        encryptString: (value) => Buffer.from(value).reverse(),
        decryptString: (value) => Buffer.from(value).reverse().toString("utf8")
      }`,
      }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
      )
        return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
})

const { parseNativeCredential, parseNativeSession } = await import("../src/main/auth/auth-api.ts")
const { accountKey, AppConfigStore, createDefaultAppConfig } =
  await import("../src/main/auth/app-config-store.ts")
const { protectNativeSession, restoreNativeSession } =
  await import("../src/main/auth/native-credential-store.ts")

const expiry = "2099-01-01T00:00:00Z"
const nativeCredential = {
  token: "access-secret",
  expires_at: expiry,
  refresh_token: "refresh-secret",
  refresh_expires_at: expiry,
  refresh_absolute_expires_at: expiry,
}

test("desktop requires a rotating native credential and rejects a legacy bearer", () => {
  assert.deepEqual(parseNativeCredential(nativeCredential), {
    token: "access-secret",
    expiresAt: expiry,
    refreshToken: "refresh-secret",
    refreshExpiresAt: expiry,
    refreshAbsoluteExpiresAt: expiry,
  })
  assert.throws(() => parseNativeCredential({ token: "old", expires_at: expiry }), /凭据格式不正确/)
  assert.throws(
    () =>
      parseNativeCredential({ ...nativeCredential, refresh_expires_at: "2000-01-01T00:00:00Z" }),
    /凭据已过期/,
  )
  assert.equal(
    parseNativeSession({
      user: { id: "u", email: "u@example.test", name: "U" },
      mobile_session: nativeCredential,
    }).credential.refreshToken,
    "refresh-secret",
  )
})

test("desktop encrypts persisted refresh credentials and rejects unprotected Linux storage", () => {
  const credential = parseNativeCredential(nativeCredential)
  const encrypted = protectNativeSession(credential)
  assert.ok(encrypted)
  assert.equal(encrypted.includes(credential.refreshToken), false)
  assert.deepEqual(restoreNativeSession(encrypted), credential)
  Object.assign(globalThis, { __testStorageBackend: "basic_text" })
  try {
    if (process.platform === "linux") {
      assert.equal(protectNativeSession(credential), null)
      assert.throws(() => restoreNativeSession(encrypted))
    }
  } finally {
    Object.assign(globalThis, { __testStorageBackend: "secure" })
  }
})

test("desktop drops plaintext legacy credentials and scrubs them from config", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "desktop-native-session-"))
  const config = createDefaultAppConfig()
  const server = config.servers[0]!
  const key = accountKey(server.url, "user-1")
  const raw = {
    ...config,
    lastAccountKey: key,
    accountSessions: {
      [key]: {
        serverId: server.id,
        userId: "user-1",
        userEmail: "u@example.test",
        userName: "U",
        token: "plaintext-legacy-secret",
        expiresAt: expiry,
        lastUsedAt: 1,
      },
    },
  }
  const filename = path.join(dir, "app-config.json")
  await writeFile(filename, JSON.stringify(raw))
  const loaded = await new AppConfigStore(dir).load()
  assert.equal(loaded.lastAccountKey, null)
  assert.deepEqual(loaded.accountSessions, {})
  assert.equal((await readFile(filename, "utf8")).includes("plaintext-legacy-secret"), false)
})
