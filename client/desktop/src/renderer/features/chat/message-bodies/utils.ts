export function progressPercentage(downloadedBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) return undefined
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
}

export function progressWidth(downloadedBytes: number, totalBytes?: number) {
  const percentage = progressPercentage(downloadedBytes, totalBytes)
  return percentage === undefined ? "33%" : `${percentage}%`
}

export function mediaUrl(targetId: string, fileId: string) {
  return `jiying-media://file/${encodeURIComponent(targetId)}/${encodeURIComponent(fileId)}`
}

export function imageThumbnailFrame(width?: number, height?: number) {
  if (!width || !height) return { width: 256, height: 256 }
  const thumbnailWidth = Math.min(320, Math.max(160, width))
  return {
    width: thumbnailWidth,
    height: Math.max(1, Math.round(Math.min(360, (height * thumbnailWidth) / width))),
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false })
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
