import type { AuthenticatedTarget } from "@/core/server-target"

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|token|access_token|session_token)$/i
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** Remove credential-bearing fields before an error or diagnostic value is logged. */
export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveValue(item),
    ])
  )
}

/** Runtime backstop for untyped/native input crossing into authenticated business data. */
export function assertSafeAuthenticatedTarget(value: unknown): asserts value is AuthenticatedTarget {
  if (!value || typeof value !== "object") throw new Error("认证目标格式不正确")
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => SENSITIVE_KEY.test(key))) {
    throw new Error("认证目标不得包含凭据")
  }
  if (typeof record.id !== "string" || typeof record.url !== "string" || typeof record.userId !== "string") {
    throw new Error("认证目标格式不正确")
  }
}

/**
 * Production transport policy. Plain HTTP/WS is permitted only when the caller
 * explicitly enables development mode and the endpoint is loopback.
 */
export function assertSecureTransport(rawUrl: string, development = false) {
  const url = new URL(rawUrl)
  if (url.protocol === "https:" || url.protocol === "wss:") return
  const localDevelopment = development && LOCAL_HOSTS.has(url.hostname)
    && (url.protocol === "http:" || url.protocol === "ws:")
  if (!localDevelopment) throw new Error("认证连接必须使用 HTTPS/WSS")
}

/** Mobile session capability responses are native-only unless explicitly trusted. */
export function isMobileCapabilityCorsOriginAllowed(
  origin: string | null,
  trustedWebOrigins: readonly string[] = []
) {
  if (origin === null) return true
  return trustedWebOrigins.includes(origin)
}
