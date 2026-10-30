import type { resolveClientEntities } from "@/lib/client-api/entity-sync"

export type GroupEntitySnapshot = Awaited<ReturnType<typeof resolveClientEntities>>
export type CachedGroupProfile = { id: string; syncedAt: number; snapshot: GroupEntitySnapshot }

export function hasCompleteGroupProfile(record: CachedGroupProfile) {
  return Array.isArray(record.snapshot?.groups) && record.snapshot.groups.some((group) => group.id === record.id) &&
    Array.isArray(record.snapshot?.conversations) && record.snapshot.conversations.some((group) =>
      group.id === record.id && group.type === "group" && Array.isArray(group.members))
}

/** IndexedDB is origin-scoped; each record is additionally isolated by authenticated user. */
export function createWebGroupProfileStore(accountId: string, factory: IDBFactory | undefined = globalThis.indexedDB) {
  const memory = new Map<string, CachedGroupProfile>()
  let opening: Promise<IDBDatabase | null> | undefined
  const open = () => opening ??= new Promise<IDBDatabase | null>((resolve) => {
    if (!factory) { resolve(null); return }
    try {
      const request = factory.open("magicchat-group-profiles", 1)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("profiles", { keyPath: ["accountId", "id"] })
        store.createIndex("accountId", "accountId")
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    } catch { resolve(null) }
  })

  async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | undefined) {
    const db = await open()
    if (!db) return undefined
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("profiles", mode)
      const request = work(tx.objectStore("profiles"))
      tx.oncomplete = () => resolve(request?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  return {
    async read(ids: string[]) {
      if (!ids.length) return []
      const wanted = new Set(ids)
      try {
        const rows = await transaction<(CachedGroupProfile & { accountId: string })[]>("readonly",
          (store) => store.index("accountId").getAll(accountId))
        if (rows) for (const row of rows) if (row.accountId === accountId && wanted.has(row.id)) memory.set(row.id, row)
      } catch { /* Storage restrictions degrade to this page's complete snapshots. */ }
      return ids.flatMap((id) => {
        const record = memory.get(id)
        return record && hasCompleteGroupProfile(record) ? [record] : []
      })
    },
    async write(records: CachedGroupProfile[]) {
      const complete = records.filter(hasCompleteGroupProfile)
      await transaction("readwrite", (store) => {
        for (const record of complete) store.put({ ...record, accountId })
        return undefined
      })
      for (const record of complete) memory.set(record.id, record)
    },
    async remove(ids: string[]) {
      for (const id of ids) memory.delete(id)
      try {
        await transaction("readwrite", (store) => {
          for (const id of ids) store.delete([accountId, id])
          return undefined
        })
      } catch { /* No timestamp is reusable without a complete in-memory snapshot. */ }
    },
    async close() { (await opening)?.close() },
  }
}
