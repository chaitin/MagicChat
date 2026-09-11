import { databaseService, isDatabasePersistenceAvailable } from "@/data/database/database-service"

export async function getGlobalMessageCacheSize(): Promise<number> {
  if (!isDatabasePersistenceAvailable) return 0
  const result = await databaseService.read("messages.global-size.read", (database) =>
    database.getFirst<{ bytes: number }>(
      `SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB)) + 256), 0) AS bytes FROM cached_messages`
    )
  )
  return result?.bytes ?? 0
}

export async function clearGlobalMessageCache(): Promise<void> {
  if (!isDatabasePersistenceAvailable) return
  await databaseService.maintenance("messages.global-cache.clear", async (database) => {
    // Use the maintenance-scoped primitive rather than recursively entering the
    // top-level service, so failure rolls all cache tables back as one unit.
    await database.transaction(async (transaction) => {
      await transaction.run("DELETE FROM cached_messages")
      await transaction.run("DELETE FROM message_sync_state")
      await transaction.run("DELETE FROM message_cache_stats")
    })
    await database.exec("PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;")
  })
}
