import { safeStorage } from "electron"
import type { SavedLogin } from "../../shared/auth"
import type { StoredLogin } from "./app-config-store"

export function readSavedLogin(stored: StoredLogin | undefined): SavedLogin | undefined {
  if (!stored) return undefined
  if (stored.method !== "password" || !stored.encryptedPassword) {
    return { method: stored.method, email: stored.email }
  }
  if (!canProtectPassword()) return { method: stored.method, email: stored.email }
  try {
    return {
      method: stored.method,
      email: stored.email,
      password: safeStorage.decryptString(Buffer.from(stored.encryptedPassword, "base64")),
    }
  } catch {
    return { method: stored.method, email: stored.email }
  }
}

export function encryptPassword(password: string): string | undefined {
  if (!canProtectPassword()) return undefined
  try {
    return safeStorage.encryptString(password).toString("base64")
  } catch {
    return undefined
  }
}

function canProtectPassword() {
  if (!safeStorage.isEncryptionAvailable()) return false
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
}
