import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import type { CachedMedia, MediaCacheRequest, MediaDownloadProgress } from "../../shared/media"
import { AuthFailure } from "../../shared/auth"
import { AccountDatabase, type StoredMediaCache } from "./account-database"

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
    validateRequest(request)
    const cacheKey = this.createCacheKey(request)
    const cached = await this.readValidRecord(cacheKey)
    if (cached) return this.toCachedMedia(cached)

    const current = this.downloads.get(cacheKey)
    if (current) return current.promise

    const controller = new AbortController()
    const promise = this.download(cacheKey, request, controller.signal).finally(() => {
      this.downloads.delete(cacheKey)
    })
    this.downloads.set(cacheKey, { controller, promise })
    return promise
  }

  async getCached(cacheKey: string): Promise<CachedMedia> {
    this.assertOpen()
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      throw new AuthFailure("invalid_media_cache_key", "媒体缓存标识不正确")
    }
    const record = await this.readValidRecord(cacheKey)
    if (!record) throw new AuthFailure("media_not_cached", "媒体文件尚未缓存")
    return this.toCachedMedia(record)
  }

  async getCachedResource(cacheKey: string): Promise<CachedMediaResource> {
    this.assertOpen()
    if (!/^[0-9a-f]{64}$/.test(cacheKey)) {
      throw new AuthFailure("invalid_media_cache_key", "媒体缓存标识不正确")
    }
    const record = await this.readValidRecord(cacheKey)
    if (!record) throw new AuthFailure("media_not_cached", "媒体文件尚未缓存")
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
    const range = parseRange(rangeHeader, resource.sizeBytes)
    const stream = createReadStream(resource.filePath, range ?? undefined)
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    if (!range) {
      return new Response(body, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=86400, immutable",
          "Content-Length": String(resource.sizeBytes),
          "Content-Type": resource.contentType,
        },
      })
    }
    const length = range.end - range.start + 1
    return new Response(body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400, immutable",
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${resource.sizeBytes}`,
        "Content-Type": resource.contentType,
      },
    })
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
      validateContentType(request.category, contentType)
      const originalName = safeOriginalName(
        responseName || request.originalName || responseUrlFileName(response.url),
        request.category,
      )
      const extension = mediaExtension(originalName, contentType)
      const relativePath = path.posix.join(request.category, `${cacheKey}${extension}`)
      const totalBytes =
        positiveInteger(response.headers.get("content-length")) ??
        positiveNumber(request.expectedSizeBytes)
      record = {
        ...record,
        relativePath,
        originalName: ensureNameExtension(originalName, extension),
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
    return createHash("sha256")
      .update("media-cache-v1")
      .update("\0")
      .update(this.namespace)
      .update("\0")
      .update(request.targetId)
      .update("\0")
      .update(request.category)
      .update("\0")
      .update(request.fileId)
      .digest("hex")
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

function validateRequest(request: MediaCacheRequest) {
  if (!request || typeof request !== "object") {
    throw new AuthFailure("invalid_media_request", "媒体缓存请求不正确")
  }
  if (!request.targetId || request.targetId.length > 128) {
    throw new AuthFailure("invalid_target", "账号标识不正确")
  }
  if (!request.fileId || request.fileId.length > 128) {
    throw new AuthFailure("invalid_file_id", "文件标识不正确")
  }
  if (!(["image", "video", "attachment"] as const).includes(request.category)) {
    throw new AuthFailure("invalid_media_category", "媒体类型不受支持")
  }
  if (request.originalName && request.originalName.length > 512) {
    throw new AuthFailure("invalid_media_name", "媒体文件名过长")
  }
  if (
    request.expectedSizeBytes !== undefined &&
    positiveNumber(request.expectedSizeBytes) === undefined
  ) {
    throw new AuthFailure("invalid_media_size", "媒体文件大小不正确")
  }
}

function validateContentType(category: MediaCacheRequest["category"], contentType: string) {
  if (contentType === "application/octet-stream") return
  if (category === "image" && !contentType.startsWith("image/")) {
    throw new AuthFailure("invalid_media_content", "图片文件类型不正确")
  }
  if (category === "video" && !contentType.startsWith("video/")) {
    throw new AuthFailure("invalid_media_content", "视频文件类型不正确")
  }
}

function parseRange(value: string | undefined, size: number) {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0) throw new AuthFailure("invalid_media_range", "媒体读取范围不正确")
  const startText = match[1]
  const endText = match[2]
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error("invalid range")
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : size - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new AuthFailure("invalid_media_range", "媒体读取范围不正确")
  }
  return { start, end: Math.min(end, size - 1) }
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

function normalizedContentType(value: string) {
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase()
  return contentType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)
    ? contentType
    : "application/octet-stream"
}

function contentDispositionFileName(value: string | null) {
  if (!value) return ""
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""))
    } catch {
      return ""
    }
  }
  return (
    /filename="([^"]+)"/i.exec(value)?.[1] ?? /filename=([^;]+)/i.exec(value)?.[1]?.trim() ?? ""
  )
}

function responseUrlFileName(value: string) {
  try {
    return decodeURIComponent(path.basename(new URL(value).pathname))
  } catch {
    return ""
  }
}

function safeOriginalName(value: string | undefined, category: MediaCacheRequest["category"]) {
  const fallback = category === "image" ? "图片" : category === "video" ? "视频" : "附件"
  if (!value) return fallback
  const name = path.basename(value.replace(/[\u0000-\u001f\u007f]/g, "")).trim()
  return name.slice(0, 255) || fallback
}

function mediaExtension(name: string, contentType: string) {
  const candidate = path.extname(name).toLowerCase()
  if (/^\.[a-z0-9]{1,12}$/.test(candidate)) return candidate
  return contentTypeExtensions[contentType] ?? ".bin"
}

function ensureNameExtension(name: string, extension: string) {
  return path.extname(name) ? name : `${name}${extension}`
}

function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined
  return positiveNumber(Number(value))
}

function positiveNumber(value: number | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

const contentTypeExtensions: Record<string, string> = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
}
