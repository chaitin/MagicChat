import { parsePendingPushRevocationQueue, type PendingPushRevocation } from "@/notifications/push-types"

export type PushRevocationStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export const PENDING_REVOCATION_KEY = "@magicchat/push-revocations/v2"

export function createPushRevocationQueueStore(storage: PushRevocationStorage) {
  const load = async (): Promise<PendingPushRevocation[]> => {
    const raw = await storage.getItem(PENDING_REVOCATION_KEY)
    if (raw === null) return []
    try {
      const parsed = parsePendingPushRevocationQueue(JSON.parse(raw))
      if (!parsed) throw new Error()
      return parsed
    } catch {
      throw new Error("待撤销推送队列数据无效")
    }
  }
  const replace = async (values: PendingPushRevocation[]) => {
    if (!values.length) { await storage.removeItem(PENDING_REVOCATION_KEY); return }
    await storage.setItem(PENDING_REVOCATION_KEY, JSON.stringify(values))
  }
  return {
    load,
    replace,
    enqueue: async (value: PendingPushRevocation) => {
      const entries = await load()
      const filtered = entries.filter((entry) => !(entry.accountId === value.accountId && entry.grantId === value.grantId))
      await replace([...filtered, value])
    },
  }
}
