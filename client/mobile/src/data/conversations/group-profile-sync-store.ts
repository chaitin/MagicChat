import type { AuthenticatedTarget } from "@/core/server-target"
import type { DatabaseService } from "@/data/database/database-service"
import { createServerKey } from "@/data/server-key"
import { GroupProfileSyncCache } from "../../../../shared/group-profile-sync-cache"

export function createMobileGroupProfileCache(
  service: DatabaseService,
  target: AuthenticatedTarget,
  options: { isCurrent: () => boolean; onError: (error: unknown) => void },
) {
  const scope = [createServerKey(target), target.userId]
  return new GroupProfileSyncCache({
    ...options,
    read: async (ids) => {
      if (!ids.length) return []
      const states = await service.read("groups.sync_state.read", (db) => db.getAll<{
        group_id: string; last_success_at: number; payload_json: string | null
      }>(`SELECT s.group_id, s.last_success_at, c.payload_json
          FROM group_profile_sync_state s LEFT JOIN cached_conversations c
          ON c.server_key=s.server_key AND c.user_id=s.user_id AND c.conversation_id=s.group_id
          AND c.tombstone_at IS NULL
          WHERE s.server_key=? AND s.user_id=?`, scope))
      const wanted = new Set(ids)
      return states.filter((row) => wanted.has(row.group_id)).map((row) => {
        let hasSnapshot = false
        try {
          const value = row.payload_json ? JSON.parse(row.payload_json) : null
          hasSnapshot = value?.type === "group" && Array.isArray(value.members)
        } catch { /* Missing/corrupt snapshots must be synchronized again. */ }
        return { id: row.group_id, syncedAt: row.last_success_at, hasSnapshot }
      })
    },
    write: (ids, syncedAt) => service.transaction("groups.sync_state.write", async (db) => {
      if (!options.isCurrent()) return
      for (const id of ids) {
        await db.run(`INSERT OR REPLACE INTO group_profile_sync_state
          (server_key,user_id,group_id,last_success_at)
          SELECT server_key,user_id,conversation_id,? FROM cached_conversations
          WHERE server_key=? AND user_id=? AND conversation_id=? AND tombstone_at IS NULL
          AND conversation_type='group'`, [syncedAt, ...scope, id])
      }
    }),
    remove: (ids) => service.transaction("groups.sync_state.remove", async (db) => {
      for (const id of ids) await db.run(
        "DELETE FROM group_profile_sync_state WHERE server_key=? AND user_id=? AND group_id=?", [...scope, id])
    }),
  })
}
