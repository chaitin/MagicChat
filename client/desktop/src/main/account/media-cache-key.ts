import { createHash } from "node:crypto"
import type { MediaCategory } from "../../shared/media"

export function createMediaCacheKey(namespace: string, category: MediaCategory, fileId: string) {
  return createHash("sha256")
    .update("media-cache-v2")
    .update("\0")
    .update(namespace)
    .update("\0")
    .update(category)
    .update("\0")
    .update(fileId)
    .digest("hex")
}
