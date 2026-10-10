import { safeStorage } from "electron"
import { AuthFailure } from "../../shared/auth"
import type { NativeSessionCredential } from "./auth-api"

function canProtectNativeSession() {
  if (!safeStorage.isEncryptionAvailable()) return false
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"
}

export function protectNativeSession(credential: NativeSessionCredential): string | null {
  if (!canProtectNativeSession()) return null
  return safeStorage.encryptString(JSON.stringify(credential)).toString("base64")
}

export function restoreNativeSession(encrypted: string): NativeSessionCredential {
  if (!canProtectNativeSession())
    throw new AuthFailure("secure_storage_unavailable", "系统安全存储不可用，请重新登录")
  try {
    const data: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64")))
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid session")
    const value = data as Partial<NativeSessionCredential>
    if (
      typeof value.token !== "string" ||
      !value.token ||
      typeof value.refreshToken !== "string" ||
      !value.refreshToken ||
      typeof value.expiresAt !== "string" ||
      typeof value.refreshExpiresAt !== "string" ||
      typeof value.refreshAbsoluteExpiresAt !== "string" ||
      ![value.expiresAt, value.refreshExpiresAt, value.refreshAbsoluteExpiresAt].every((expiry) =>
        Number.isFinite(Date.parse(expiry)),
      ) ||
      Date.parse(value.refreshExpiresAt) <= Date.now() ||
      Date.parse(value.refreshAbsoluteExpiresAt) <= Date.now()
    )
      throw new Error("expired session")
    return value as NativeSessionCredential
  } catch {
    throw new AuthFailure("invalid_session", "保存的登录状态已失效，请重新登录")
  }
}
