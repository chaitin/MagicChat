import { messageManager } from "@/data/messages"
import {
  clearResourceCache,
  getResourceCacheSize,
} from "@/data/resources/resource-repository"

export type StorageStats = {
  mediaBytes: number
  messageBytes: number
  totalBytes: number
}

export async function readStorageStats(): Promise<StorageStats> {
  const [mediaBytes, messageBytes] = await Promise.all([
    getResourceCacheSize(),
    messageManager.getOfflineMessageSize(),
  ])
  return { mediaBytes, messageBytes, totalBytes: mediaBytes + messageBytes }
}

export async function clearStorage(
  parts: readonly ("media" | "messages")[]
): Promise<{ failed: ("media" | "messages")[] }> {
  const unique = [...new Set(parts)]
  const results = await Promise.allSettled(
    unique.map((part) =>
      part === "media" ? clearResourceCache() : messageManager.clearAllOfflineMessages()
    )
  )
  return {
    failed: unique.filter((_, index) => results[index].status === "rejected"),
  }
}

export { formatStorageSize } from "@/features/storage/storage-model"
