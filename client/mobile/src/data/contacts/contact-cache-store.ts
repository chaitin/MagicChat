import type { ClientContactDirectory, ResolvedClientUser } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { databaseService } from "@/data/database/database-service"
import { createServerKey } from "@/data/server-key"

type ProfileRow = { cached_at: number; missing_until: number | null; payload_json: string | null; version: string | null }

export async function readContactDirectory(target: AuthenticatedTarget) {
  const row = await databaseService.read("contacts.directory.read", (db) => db.getFirst<{ payload_json: string }>(
    "SELECT payload_json FROM cached_contact_directories WHERE server_key = ? AND user_id = ?",
    [createServerKey(target), target.userId]
  ))
  return parse<ClientContactDirectory>(row?.payload_json)
}

export async function replaceContactDirectory(target: AuthenticatedTarget, value: ClientContactDirectory) {
  const now = Date.now()
  await databaseService.write("contacts.directory.replace", (db) => db.run(
    `INSERT OR REPLACE INTO cached_contact_directories
     (server_key,user_id,payload_json,observed_at,cached_at) VALUES (?,?,?,?,?)`,
    [createServerKey(target), target.userId, JSON.stringify(value), now, now]
  ))
}

export async function readUserProfiles(target: AuthenticatedTarget) {
  const result = new Map<string, ProfileRow & { profile: ResolvedClientUser | null }>()
  const rows = await databaseService.read("contacts.profiles.read", (db) => db.getAll<ProfileRow & { profile_user_id: string }>(
    "SELECT profile_user_id,payload_json,version,cached_at,missing_until FROM cached_user_profiles WHERE server_key = ? AND user_id = ?",
    [createServerKey(target), target.userId]
  ))
  for (const row of rows) {
    const profile = parse<ResolvedClientUser>(row.payload_json)
    if (row.payload_json && !profile) continue
    result.set(row.profile_user_id, { ...row, profile })
  }
  return result
}

export async function mergeUserProfiles(target: AuthenticatedTarget, profiles: ResolvedClientUser[], missingIds: string[], missingUntil: number) {
  const key = createServerKey(target)
  const now = Date.now()
  await databaseService.transaction("contacts.profiles.merge", async (transaction) => {
    for (const profile of profiles) {
      await transaction.run(
        `INSERT INTO cached_user_profiles (server_key,user_id,profile_user_id,payload_json,version,cached_at,missing_until)
         VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(server_key,user_id,profile_user_id) DO UPDATE SET
         payload_json=excluded.payload_json,version=excluded.version,cached_at=excluded.cached_at,missing_until=NULL
         WHERE cached_user_profiles.version IS NULL OR cached_user_profiles.version <= excluded.version`,
        [key, target.userId, profile.id, JSON.stringify(profile), profile.updatedAt, now]
      )
    }
    for (const id of missingIds) await transaction.run(
      `INSERT INTO cached_user_profiles (server_key,user_id,profile_user_id,payload_json,version,cached_at,missing_until)
       VALUES (?,?,?,NULL,NULL,?,?) ON CONFLICT(server_key,user_id,profile_user_id) DO UPDATE SET
       payload_json=NULL,version=NULL,cached_at=excluded.cached_at,missing_until=excluded.missing_until`,
      [key, target.userId, id, now, missingUntil]
    )
  })
}

function parse<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}
