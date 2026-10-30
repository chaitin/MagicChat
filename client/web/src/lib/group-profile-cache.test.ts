import { describe, expect, it } from "vitest"
import { createWebGroupProfileStore, type CachedGroupProfile } from "./group-profile-cache"

function databaseFactory(failWrites = false) {
  const records = new Map<string, { accountId: string } & CachedGroupProfile>()
  let created = false
  return {
    open() {
      const request: Record<string, unknown> = {}
      queueMicrotask(() => {
        const store = {
          createIndex: () => undefined,
          put: (record: { accountId: string } & CachedGroupProfile) => { if (failWrites) throw new Error("disk"); records.set(JSON.stringify([record.accountId, record.id]), structuredClone(record)) },
          delete: (key: string[]) => records.delete(JSON.stringify(key)),
          index: () => ({ getAll: (accountId: string) => ({ result: [...records.values()].filter((row) => row.accountId === accountId).map((row) => structuredClone(row)) }) }),
        }
        request.result = {
          createObjectStore: () => store,
          close: () => undefined,
          transaction: () => {
            const tx: Record<string, unknown> = { objectStore: () => store }
            setTimeout(() => (tx.oncomplete as (() => void) | undefined)?.(), 0)
            return tx
          },
        }
        if (!created) { created = true; (request.onupgradeneeded as (() => void) | undefined)?.() }
        ;(request.onsuccess as (() => void) | undefined)?.()
      })
      return request
    },
  } as unknown as IDBFactory
}

const record = (): CachedGroupProfile => ({
  id: "g", syncedAt: Date.now(), snapshot: {
    users: [], apps: [], removed: [], versions: { "group:g": 1 },
    groups: [{ id: "g", joined: true }], conversations: [{ id: "g", type: "group", members: [] }],
  } as unknown as CachedGroupProfile["snapshot"],
})

describe("Web群资料持久化", () => {
  it("快照和时间一起保存，重建页面后可恢复，按账号读取并可删除", async () => {
    const factory = databaseFactory()
    const first = createWebGroupProfileStore("me", factory)
    const value = record()
    await first.write([value])
    await first.close()
    const reopened = createWebGroupProfileStore("me", factory)
    expect(await reopened.read(["g"])).toEqual([{ ...value, accountId: "me" }])
    expect(await createWebGroupProfileStore("other", factory).read(["g"])).toEqual([])
    await reopened.remove(["g"])
    expect(await createWebGroupProfileStore("me", factory).read(["g"])).toEqual([])
  })

  it("持久化写入失败不会在内存中记录新的成功时间", async () => {
    const store = createWebGroupProfileStore("me", databaseFactory(true))
    await expect(store.write([record()])).rejects.toThrow("disk")
    expect(await store.read(["g"])).toEqual([])
  })

  it("只有时间或部分资料不能充当完整缓存，存储不可用时仅在当前页复用", async () => {
    const store = createWebGroupProfileStore("me", undefined)
    await store.write([{ ...record(), snapshot: { ...record().snapshot, conversations: [] } }])
    expect(await store.read(["g"])).toEqual([])
    await store.write([record()])
    expect(await store.read(["g"])).toHaveLength(1)
    expect(await createWebGroupProfileStore("me", undefined).read(["g"])).toEqual([])
    await store.remove(["g"])
    expect(await store.read(["g"])).toEqual([])
  })
})
