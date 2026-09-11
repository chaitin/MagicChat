import {
  createAccountRecord,
  type AccountRecord,
  type AccountStore,
} from "@/data/auth/account-store"

export const LEGACY_AUTH_SESSION_KEY = "@magicchat/auth-session/v1"
export const ACCOUNT_MIGRATION_MARKER_KEY = "@magicchat/account-migration/v2"

type MigrationStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

type LegacyTarget = { id: string; url: string; userId: string }
type Marker = { version: 2; phase: "indexed" | "complete"; outcome: "none" | "invalid" | "reauth-required" }

export type AccountMigrationDependencies = {
  storage: MigrationStorage
  accountStore: Pick<AccountStore, "importReauthRequired" | "hydrate">
  now?: () => Date
  migrateLoginAssistance?: (target: LegacyTarget, account: AccountRecord) => Promise<void>
}

/**
 * Migrates identity metadata only. This module deliberately has no SQLite,
 * Query, Cookie or Session-credential dependency.
 */
export async function migrateLegacyAccount({
  storage, accountStore, now = () => new Date(), migrateLoginAssistance,
}: AccountMigrationDependencies): Promise<Marker> {
  const marker = parseMarker(await storage.getItem(ACCOUNT_MIGRATION_MARKER_KEY))
  if (marker?.phase === "complete") {
    await storage.removeItem(LEGACY_AUTH_SESSION_KEY)
    return marker
  }

  const raw = await storage.getItem(LEGACY_AUTH_SESSION_KEY)
  const target = parseLegacyTarget(raw)
  if (!raw || !target) {
    const complete: Marker = { version: 2, phase: "complete", outcome: raw ? "invalid" : "none" }
    await storage.setItem(ACCOUNT_MIGRATION_MARKER_KEY, JSON.stringify(complete))
    if (raw) await storage.removeItem(LEGACY_AUTH_SESSION_KEY)
    return complete
  }

  const account = createAccountRecord({
    serverId: target.id,
    url: target.url,
    userId: target.userId,
    name: target.userId,
    lastUsedAt: now().toISOString(),
    status: "reauth-required",
  })
  await accountStore.importReauthRequired(account)
  await accountStore.hydrate()
  await migrateLoginAssistance?.(target, account)

  const indexed: Marker = { version: 2, phase: "indexed", outcome: "reauth-required" }
  await storage.setItem(ACCOUNT_MIGRATION_MARKER_KEY, JSON.stringify(indexed))
  const complete: Marker = { ...indexed, phase: "complete" }
  await storage.setItem(ACCOUNT_MIGRATION_MARKER_KEY, JSON.stringify(complete))
  await storage.removeItem(LEGACY_AUTH_SESSION_KEY)
  return complete
}

function parseLegacyTarget(raw: string | null): LegacyTarget | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isObject(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.url !== "string" || !value.url.trim() ||
      typeof value.userId !== "string" || !value.userId.trim()) return null
    // createAccountRecord performs the canonical strict URL validation.
    createAccountRecord({ serverId: value.id, url: value.url, userId: value.userId,
      name: value.userId, lastUsedAt: new Date(0).toISOString() })
    return { id: value.id.trim(), url: value.url, userId: value.userId.trim() }
  } catch { return null }
}

function parseMarker(raw: string | null): Marker | null {
  try {
    const value: unknown = raw && JSON.parse(raw)
    if (!isObject(value) || value.version !== 2 ||
      (value.phase !== "indexed" && value.phase !== "complete") ||
      (value.outcome !== "none" && value.outcome !== "invalid" && value.outcome !== "reauth-required")) return null
    return value as Marker
  } catch { return null }
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
