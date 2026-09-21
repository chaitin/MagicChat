import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { CachedMedia, MediaCacheRequest, MediaDownloadProgress } from "../../shared/media"
import { AuthFailure } from "../../shared/auth"
import { createLocalFileResponse } from "../local-file-response"
import { AccountDatabase, type StoredMediaCache } from "./account-database"
import { numberedAttachmentFileName } from "./attachment-file-name"
import { createMediaCacheKey } from "./media-cache-key"
import {
  contentDispositionFileName,
  ensureNameExtension,
  mediaExtension,
  normalizedContentType,
  positiveInteger,
  positiveNumber,
  responseUrlFileName,
  safeOriginalName,
  validateMediaCacheRequest,
  validateMediaContentType,
} from "./media-cache-policy"

export type CachedMediaResource = {
  contentType: string
  filePath: string
  sizeBytes: number
}

type DownloadJob = {
  controller: AbortController
  promise: Promise<CachedMedia>
}

export class MediaManager {
  private readonly cacheRoot: string
  private readonly downloads = new Map<string, DownloadJob>()
  private readonly verifiedModifiedAt = new Map<string, number>()
  private readonly reservedAttachmentPaths = new Set<string>()
  private closed = false

  constructor(
    accountDirectory: string,
    private readonly namespace: string,
    private readonly database: AccountDatabase,
    private readonly fetchTemporaryFile: (fileId: string, signal: AbortSignal) => Promise<Response>,
    private readonly onProgress: (event: MediaDownloadProgress) => void,
  ) {
    this.cacheRoot = path.join(accountDirectory, "media-cache")
  }

  async initialize() {
    await Promise.all([
      mkdir(path.join(this.cacheRoot, "image"), { recursive: true }),
      mkdir(path.join(this.cacheRoot, "video"), { recursive: true }),
      mkdir(path.join(this.cacheRoot, "attachment"), { recursive: true }),
    ])
    await this.recoverIncompleteDownloads()
  }

  async ensureCached(request: MediaCacheRequest): Promise<CachedMedia> {
    this.assertOpen()
    validateMediaCacheRequest(request)
    const cacheKey = this.createCacheKey(request)
    const cached = await this.findCachedRecord(request, cacheKey)
    if (cached) return this.toCachedMedia(await this.ensureFriendlyAttachmentPath(cached))

    const current = this.downloads.get(cacheKey)
    if (current) return current.promise

    const controller = new AbortController()
    const promise = this.download(cacheKey, request, controller.signal).finally(() => {
      this.downloads.delete(cacheKey)
    })
    this.downloads.set(cacheKey, { controller, promise })
    return promise
  }

  async checkCached(request: MediaCacheRequest): Promise<CachedMedia | null> {
    this.assertOpen()
    validateMediaCacheRequest(request)
    const cached = await this.findCachedRecord(request, this.createCacheKey(request))
    return cached ? this.toCachedMedia(await this.ensureFriendlyAttachmentPath(cached)) : null
  }

  async getCached(cacheKey: string): Promise<CachedMedia> {
    this.assertOpen()
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      throw new AuthFailure("invalid_media_cache_key", "媒体缓存标识不正确")
    }
    const record = await this.readValidRecord(cacheKey)
    if (!record) throw new AuthFailure("media_not_cached", "媒体文件尚未缓存")
    return this.toCachedMedia(await this.ensureFriendlyAttachmentPath(record))
  }

  async getCachedResource(cacheKey: string): Promise<CachedMediaResource> {
    this.assertOpen()
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      throw new AuthFailure("invalid_media_cache_key", "媒体缓存标识不正确")
    }
    const existing = await this.readValidRecord(cacheKey)
    if (!existing) throw new AuthFailure("media_not_cached", "媒体文件尚未缓存")
    const record = await this.ensureFriendlyAttachmentPath(existing)
    const now = Date.now()
    this.database.touchMediaCache(cacheKey, now)
    return {
      contentType: record.contentType,
      filePath: this.resolveRelativePath(record.relativePath),
      sizeBytes: record.sizeBytes,
    }
  }

  async createResourceResponse(cacheKey: string, rangeHeader?: string): Promise<Response> {
    const resource = await this.getCachedResource(cacheKey)
    return createLocalFileResponse(
      resource.filePath,
      resource.sizeBytes,
      resource.contentType,
      rangeHeader,
      { cacheControl: "private, max-age=86400, immutable", cors: false },
    )
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const job of this.downloads.values()) job.controller.abort()
    this.downloads.clear()
    this.verifiedModifiedAt.clear()
  }

  private async download(
    cacheKey: string,
    request: MediaCacheRequest,
    signal: AbortSignal,
  ): Promise<CachedMedia> {
    const createdAt = Date.now()
    let record = this.createPendingRecord(cacheKey, request, createdAt)
    this.database.upsertMediaCache(record)
    this.emitProgress(record, "downloading", 0, request.expectedSizeBytes)

    try {
      const response = await this.fetchTemporaryFile(request.fileId, signal)
      if (!response.ok || !response.body) {
        throw new AuthFailure("media_download_failed", "媒体文件下载失败")
      }
      if (signal.aborted) throw new AuthFailure("media_download_cancelled", "媒体文件下载已取消")

      const responseName = contentDispositionFileName(response.headers.get("content-disposition"))
      const contentType = normalizedContentType(
        response.headers.get("content-type") || request.contentType || "application/octet-stream",
      )
      validateMediaContentType(request.category, contentType)
      const originalName = safeOriginalName(
        responseName || request.originalName || responseUrlFileName(response.url),
        request.category,
      )
      const extension = mediaExtension(originalName, contentType)
      const finalOriginalName = ensureNameExtension(originalName, extension)
      const relativePath =
        request.category === "attachment"
          ? await this.reserveAttachmentPath(finalOriginalName)
          : path.posix.join(request.category, `${cacheKey}${extension}`)
      const totalBytes =
        positiveInteger(response.headers.get("content-length")) ??
        positiveNumber(request.expectedSizeBytes)
      record = {
        ...record,
        relativePath,
        originalName: finalOriginalName,
        contentType,
        extension,
        sizeBytes: totalBytes ?? 0,
      }
      this.database.upsertMediaCache(record)

      const finalPath = this.resolveRelativePath(relativePath)
      const temporaryPath = `${finalPath}.part`
      await mkdir(path.dirname(finalPath), { recursive: true })
      await rm(temporaryPath, { force: true })

      const file = await open(temporaryPath, "w")
      const hash = createHash("sha256")
      const reader = response.body.getReader()
      let downloadedBytes = 0
      let lastProgressAt = 0
      try {
        while (true) {
          if (signal.aborted)
            throw new AuthFailure("media_download_cancelled", "媒体文件下载已取消")
          const chunk = await reader.read()
          if (chunk.done) break
          const bytes = Buffer.from(chunk.value)
          let offset = 0
          while (offset < bytes.byteLength) {
            const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset)
            if (bytesWritten <= 0) throw new Error("媒体缓存写入失败")
            offset += bytesWritten
          }
          hash.update(bytes)
          downloadedBytes += bytes.byteLength
          const now = Date.now()
          if (now - lastProgressAt >= 100) {
            this.emitProgress(record, "downloading", downloadedBytes, totalBytes)
            lastProgressAt = now
          }
        }
        await file.sync()
      } finally {
        reader.releaseLock()
        await file.close()
      }

      if (signal.aborted || this.closed) {
        throw new AuthFailure("media_download_cancelled", "媒体文件下载已取消")
      }
      if (downloadedBytes === 0 && request.category !== "attachment") {
        throw new AuthFailure("media_empty", "媒体文件内容为空")
      }
      if (totalBytes !== undefined && downloadedBytes !== totalBytes) {
        throw new AuthFailure("media_size_mismatch", "媒体文件大小校验失败")
      }
      const digest = hash.digest("hex")
      record = {
        ...record,
        status: "verifying",
        sizeBytes: downloadedBytes,
        sha256: digest,
      }
      this.database.upsertMediaCache(record)
      this.emitProgress(record, "verifying", downloadedBytes, downloadedBytes)

      await rm(finalPath, { force: true })
      await rename(temporaryPath, finalPath)
      const fileStat = await stat(finalPath)
      record = {
        ...record,
        status: "ready",
        modifiedAtMs: fileStat.mtimeMs,
        lastAccessedAt: Date.now(),
      }
      if (signal.aborted || this.closed) {
        throw new AuthFailure("media_download_cancelled", "媒体文件下载已取消")
      }
      this.database.upsertMediaCache(record)
      this.verifiedModifiedAt.set(cacheKey, fileStat.mtimeMs)
      this.emitProgress(record, "ready", downloadedBytes, downloadedBytes)
      return this.toCachedMedia(record)
    } catch (error) {
      await this.removeRecordFiles(record)
      const failed = { ...record, status: "failed" as const, lastAccessedAt: Date.now() }
      if (!this.closed) {
        this.database.upsertMediaCache(failed)
        this.emitProgress(
          failed,
          "failed",
          0,
          positiveNumber(request.expectedSizeBytes),
          error instanceof Error ? error.message : "媒体文件下载失败",
        )
      }
      throw error
    } finally {
      if (record.category === "attachment") {
        this.reservedAttachmentPaths.delete(record.relativePath)
      }
    }
  }

  private createPendingRecord(
    cacheKey: string,
    request: MediaCacheRequest,
    createdAt: number,
  ): StoredMediaCache {
    return {
      cacheKey,
      category: request.category,
      targetId: request.targetId,
      fileId: request.fileId,
      status: "downloading",
      relativePath: path.posix.join(request.category, `${cacheKey}.bin`),
      originalName: safeOriginalName(request.originalName, request.category),
      contentType: normalizedContentType(request.contentType || "application/octet-stream"),
      extension: ".bin",
      sizeBytes: positiveNumber(request.expectedSizeBytes) ?? 0,
      sha256: "",
      modifiedAtMs: 0,
      createdAt,
      lastAccessedAt: createdAt,
    }
  }

  private async findCachedRecord(request: MediaCacheRequest, cacheKey: string) {
    const exact = await this.readValidRecord(cacheKey)
    if (exact) return this.updateCacheTarget(exact, request.targetId)
    for (const candidate of this.database.listMediaCachesByFile(request.category, request.fileId)) {
      if (candidate.cacheKey === cacheKey) continue
      const cached = await this.readValidRecord(candidate.cacheKey)
      if (cached) return this.updateCacheTarget(cached, request.targetId)
    }
    return undefined
  }

  private updateCacheTarget(record: StoredMediaCache, targetId: string) {
    if (record.targetId === targetId) return record
    const updated = { ...record, targetId, lastAccessedAt: Date.now() }
    this.database.upsertMediaCache(updated)
    return updated
  }

  private async readValidRecord(cacheKey: string): Promise<StoredMediaCache | undefined> {
    const record = this.database.getMediaCache(cacheKey)
    if (!record || record.status !== "ready") return undefined
    try {
      const filePath = this.resolveRelativePath(record.relativePath)
      const fileStat = await stat(filePath)
      if (!fileStat.isFile() || fileStat.size !== record.sizeBytes) throw new Error("size mismatch")
      if (
        this.verifiedModifiedAt.get(cacheKey) !== fileStat.mtimeMs ||
        record.modifiedAtMs !== fileStat.mtimeMs
      ) {
        if ((await hashFile(filePath)) !== record.sha256) throw new Error("hash mismatch")
        this.verifiedModifiedAt.set(cacheKey, fileStat.mtimeMs)
        if (record.modifiedAtMs !== fileStat.mtimeMs) {
          const updated = { ...record, modifiedAtMs: fileStat.mtimeMs }
          this.database.upsertMediaCache(updated)
          return updated
        }
      }
      return record
    } catch {
      await this.removeRecordFiles(record)
      this.database.deleteMediaCache(cacheKey)
      this.verifiedModifiedAt.delete(cacheKey)
      return undefined
    }
  }

  private async recoverIncompleteDownloads() {
    for (const record of this.database.listIncompleteMediaCaches()) {
      if (record.status === "verifying" && record.sha256 && record.sizeBytes > 0) {
        try {
          const filePath = this.resolveRelativePath(record.relativePath)
          const fileStat = await stat(filePath)
          if (
            fileStat.isFile() &&
            fileStat.size === record.sizeBytes &&
            (await hashFile(filePath)) === record.sha256
          ) {
            this.database.upsertMediaCache({
              ...record,
              status: "ready",
              modifiedAtMs: fileStat.mtimeMs,
              lastAccessedAt: Date.now(),
            })
            this.verifiedModifiedAt.set(record.cacheKey, fileStat.mtimeMs)
            continue
          }
        } catch {
          // Incomplete entries are removed below.
        }
      }
      await this.removeRecordFiles(record)
      this.database.deleteMediaCache(record.cacheKey)
    }
  }

  private async ensureFriendlyAttachmentPath(record: StoredMediaCache) {
    if (
      record.category !== "attachment" ||
      !path.posix.basename(record.relativePath).startsWith(record.cacheKey)
    ) {
      return record
    }
    const relativePath = await this.reserveAttachmentPath(record.originalName)
    try {
      await rename(
        this.resolveRelativePath(record.relativePath),
        this.resolveRelativePath(relativePath),
      )
      const updated = { ...record, relativePath }
      this.database.upsertMediaCache(updated)
      return updated
    } catch {
      return record
    } finally {
      this.reservedAttachmentPaths.delete(relativePath)
    }
  }

  private async reserveAttachmentPath(originalName: string) {
    for (let index = 0; index < 10_000; index += 1) {
      const fileName = numberedAttachmentFileName(originalName, index)
      const relativePath = path.posix.join("attachment", fileName)
      if (this.reservedAttachmentPaths.has(relativePath)) continue
      const exists = await stat(this.resolveRelativePath(relativePath))
        .then((value) => value.isFile() || value.isDirectory())
        .catch(() => false)
      if (exists) continue
      this.reservedAttachmentPaths.add(relativePath)
      return relativePath
    }
    throw new AuthFailure("media_name_exhausted", "无法为附件分配本地文件名")
  }

  private async removeRecordFiles(record: StoredMediaCache) {
    try {
      const finalPath = this.resolveRelativePath(record.relativePath)
      await Promise.all([rm(finalPath, { force: true }), rm(`${finalPath}.part`, { force: true })])
    } catch {
      // Invalid or already removed cache paths are ignored.
    }
  }

  private resolveRelativePath(relativePath: string) {
    const resolved = path.resolve(this.cacheRoot, relativePath)
    const root = `${path.resolve(this.cacheRoot)}${path.sep}`
    if (!resolved.startsWith(root)) {
      throw new AuthFailure("invalid_media_cache_path", "媒体缓存路径不正确")
    }
    return resolved
  }

  private createCacheKey(request: MediaCacheRequest) {
    return createMediaCacheKey(this.namespace, request.category, request.fileId)
  }

  private toCachedMedia(record: StoredMediaCache): CachedMedia {
    return {
      cacheKey: record.cacheKey,
      category: record.category,
      contentType: record.contentType,
      originalName: record.originalName,
      resourceUrl: `jiying-media://cache/${encodeURIComponent(record.targetId)}/${record.cacheKey}`,
      sizeBytes: record.sizeBytes,
    }
  }

  private emitProgress(
    record: StoredMediaCache,
    status: MediaDownloadProgress["status"],
    downloadedBytes: number,
    totalBytes?: number,
    message?: string,
  ) {
    this.onProgress({
      targetId: record.targetId,
      cacheKey: record.cacheKey,
      category: record.category,
      fileId: record.fileId,
      status,
      downloadedBytes,
      totalBytes,
      message,
    })
  }

  private assertOpen() {
    if (this.closed) throw new AuthFailure("account_closed", "账号数据已关闭")
  }
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}
