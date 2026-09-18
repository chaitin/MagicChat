import path from "node:path"
import type { MediaCacheRequest } from "../../shared/media"
import { AuthFailure } from "../../shared/auth"

export function validateMediaCacheRequest(request: MediaCacheRequest) {
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

export function validateMediaContentType(
  category: MediaCacheRequest["category"],
  contentType: string,
) {
  if (contentType === "application/octet-stream") return
  if (category === "image" && !contentType.startsWith("image/")) {
    throw new AuthFailure("invalid_media_content", "图片文件类型不正确")
  }
  if (category === "video" && !contentType.startsWith("video/")) {
    throw new AuthFailure("invalid_media_content", "视频文件类型不正确")
  }
}

export function normalizedContentType(value: string) {
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase()
  return contentType && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType)
    ? contentType
    : "application/octet-stream"
}

export function contentDispositionFileName(value: string | null) {
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

export function responseUrlFileName(value: string) {
  try {
    return decodeURIComponent(path.basename(new URL(value).pathname))
  } catch {
    return ""
  }
}

export function safeOriginalName(
  value: string | undefined,
  category: MediaCacheRequest["category"],
) {
  const fallback = category === "image" ? "图片" : category === "video" ? "视频" : "附件"
  if (!value) return fallback
  const name = path.basename(value.replace(/[\u0000-\u001f\u007f]/g, "")).trim()
  return name.slice(0, 255) || fallback
}

export function mediaExtension(name: string, contentType: string) {
  const candidate = path.extname(name).toLowerCase()
  if (/^\.[a-z0-9]{1,12}$/.test(candidate)) return candidate
  return contentTypeExtensions[contentType] ?? ".bin"
}

export function ensureNameExtension(name: string, extension: string) {
  return path.extname(name) ? name : `${name}${extension}`
}

export function positiveInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined
  return positiveNumber(Number(value))
}

export function positiveNumber(value: number | undefined) {
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
