import type { DatabaseSync } from "node:sqlite"
import type { MediaCacheStatus, MediaCategory } from "../../../shared/media"
import type { AvatarCacheRecord } from "../avatar-types"

export type StoredMediaCache = {
  cacheKey: string
  category: MediaCategory
  targetId: string
  fileId: string
  status: MediaCacheStatus
  relativePath: string
  originalName: string
  contentType: string
  extension: string
  sizeBytes: number
  sha256: string
  modifiedAtMs: number
  createdAt: number
  lastAccessedAt: number
}

export class CacheRepository {
  constructor(private readonly database: DatabaseSync) {}

  getAvatar(type: string, entityId: string): AvatarCacheRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT type, entity_id, source_url, local_file, content_type,
                resource_key, downloaded_at, checked_at
         FROM avatar_cache WHERE type = ? AND entity_id = ?`,
      )
      .get(type, entityId) as Record<string, unknown> | undefined
    return row ? avatarCacheRecord(row) : undefined
  }

  getAvatarByResourceKey(resourceKey: string): AvatarCacheRecord | undefined {
    const row = this.database
      .prepare(
        `SELECT type, entity_id, source_url, local_file, content_type,
                resource_key, downloaded_at, checked_at
         FROM avatar_cache WHERE resource_key = ?`,
      )
      .get(resourceKey) as Record<string, unknown> | undefined
    return row ? avatarCacheRecord(row) : undefined
  }

  upsertAvatar(record: AvatarCacheRecord) {
    this.database
      .prepare(
        `INSERT INTO avatar_cache (
           type, entity_id, source_url, local_file, content_type,
           resource_key, downloaded_at, checked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(type, entity_id) DO UPDATE SET
           source_url = excluded.source_url,
           local_file = excluded.local_file,
           content_type = excluded.content_type,
           resource_key = excluded.resource_key,
           downloaded_at = excluded.downloaded_at,
           checked_at = excluded.checked_at`,
      )
      .run(
        record.type,
        record.entityId,
        record.sourceUrl,
        record.localFile,
        record.contentType,
        record.resourceKey,
        record.downloadedAt,
        record.checkedAt,
      )
  }

  touchAvatar(type: string, entityId: string, checkedAt: number) {
    this.database
      .prepare("UPDATE avatar_cache SET checked_at = ? WHERE type = ? AND entity_id = ?")
      .run(checkedAt, type, entityId)
  }

  deleteAvatar(type: string, entityId: string): AvatarCacheRecord | undefined {
    const record = this.getAvatar(type, entityId)
    if (record) {
      this.database
        .prepare("DELETE FROM avatar_cache WHERE type = ? AND entity_id = ?")
        .run(type, entityId)
    }
    return record
  }

  deleteAvatars(types: string[], entityId: string): AvatarCacheRecord[] {
    return types.flatMap((type) => {
      const record = this.deleteAvatar(type, entityId)
      return record ? [record] : []
    })
  }

  getMedia(cacheKey: string): StoredMediaCache | undefined {
    const row = this.database
      .prepare(
        `SELECT cache_key, category, target_id, file_id, status, relative_path,
                original_name, content_type, extension, size_bytes, sha256,
                modified_at_ms, created_at, last_accessed_at
         FROM media_cache WHERE cache_key = ?`,
      )
      .get(cacheKey) as Record<string, unknown> | undefined
    return row ? mediaCacheRecord(row) : undefined
  }

  listIncompleteMedia(): StoredMediaCache[] {
    return (
      this.database
        .prepare(
          `SELECT cache_key, category, target_id, file_id, status, relative_path,
                  original_name, content_type, extension, size_bytes, sha256,
                  modified_at_ms, created_at, last_accessed_at
           FROM media_cache WHERE status <> 'ready'`,
        )
        .all() as Array<Record<string, unknown>>
    ).map(mediaCacheRecord)
  }

  upsertMedia(record: StoredMediaCache) {
    this.database
      .prepare(
        `INSERT INTO media_cache (
           cache_key, category, target_id, file_id, status, relative_path,
           original_name, content_type, extension, size_bytes, sha256,
           modified_at_ms, created_at, last_accessed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           category = excluded.category,
           target_id = excluded.target_id,
           file_id = excluded.file_id,
           status = excluded.status,
           relative_path = excluded.relative_path,
           original_name = excluded.original_name,
           content_type = excluded.content_type,
           extension = excluded.extension,
           size_bytes = excluded.size_bytes,
           sha256 = excluded.sha256,
           modified_at_ms = excluded.modified_at_ms,
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(
        record.cacheKey,
        record.category,
        record.targetId,
        record.fileId,
        record.status,
        record.relativePath,
        record.originalName,
        record.contentType,
        record.extension,
        record.sizeBytes,
        record.sha256,
        record.modifiedAtMs,
        record.createdAt,
        record.lastAccessedAt,
      )
  }

  touchMedia(cacheKey: string, lastAccessedAt: number) {
    this.database
      .prepare("UPDATE media_cache SET last_accessed_at = ? WHERE cache_key = ?")
      .run(lastAccessedAt, cacheKey)
  }

  deleteMedia(cacheKey: string) {
    this.database.prepare("DELETE FROM media_cache WHERE cache_key = ?").run(cacheKey)
  }
}

function mediaCacheRecord(row: Record<string, unknown>): StoredMediaCache {
  return {
    cacheKey: String(row.cache_key),
    category: String(row.category) as MediaCategory,
    targetId: String(row.target_id),
    fileId: String(row.file_id),
    status: String(row.status) as MediaCacheStatus,
    relativePath: String(row.relative_path),
    originalName: String(row.original_name),
    contentType: String(row.content_type),
    extension: String(row.extension),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    modifiedAtMs: Number(row.modified_at_ms),
    createdAt: Number(row.created_at),
    lastAccessedAt: Number(row.last_accessed_at),
  }
}

function avatarCacheRecord(row: Record<string, unknown>): AvatarCacheRecord {
  return {
    type: String(row.type),
    entityId: String(row.entity_id),
    sourceUrl: String(row.source_url),
    localFile: String(row.local_file),
    contentType: String(row.content_type),
    resourceKey: String(row.resource_key),
    downloadedAt: Number(row.downloaded_at),
    checkedAt: Number(row.checked_at),
  }
}
