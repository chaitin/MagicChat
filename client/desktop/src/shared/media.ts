import type { AvatarType } from "./account-data"
import type { AuthResult } from "./auth"
import type { DesktopPlatform } from "./desktop"

export type MediaCategory = "image" | "video" | "attachment"
export type MediaCacheStatus = "downloading" | "verifying" | "ready" | "failed"

export type MediaCacheRequest = {
  targetId: string
  fileId: string
  category: MediaCategory
  originalName?: string
  contentType?: string
  expectedSizeBytes?: number
}

export type CachedMedia = {
  cacheKey: string
  category: MediaCategory
  contentType: string
  originalName: string
  resourceUrl: string
  sizeBytes: number
}

export type MediaDownloadProgress = {
  targetId: string
  cacheKey: string
  category: MediaCategory
  fileId: string
  status: MediaCacheStatus
  downloadedBytes: number
  totalBytes?: number
  message?: string
}

export type MediaPreviewRequest =
  | {
      targetId: string
      cacheKey: string
      conversationName: string
    }
  | {
      targetId: string
      avatar: {
        type: Extract<AvatarType, "user" | "app" | "group">
        id: string
        theme: "light" | "dark"
      }
      conversationName: string
    }

export type MediaPreviewPayload = {
  title: string
  category: Extract<MediaCategory, "image" | "video">
  contentType: string
  originalName: string
  resourceUrl: string
}

export const MEDIA_CHANNELS = {
  ensureCached: "desktop-next:v1:media-ensure-cached",
  openPreview: "desktop-next:v1:media-open-preview",
  downloadProgress: "desktop-next:v1:media-download-progress",
  previewInitialize: "desktop-next:v1:media-preview-initialize",
  previewChanged: "desktop-next:v1:media-preview-changed",
} as const

export interface MediaBridge {
  ensureCached(input: MediaCacheRequest): Promise<AuthResult<CachedMedia>>
  openPreview(input: MediaPreviewRequest): Promise<AuthResult<null>>
  onDownloadProgress(callback: (event: MediaDownloadProgress) => void): () => void
}

export interface MediaPreviewBridge {
  initialize(): Promise<MediaPreviewPayload>
  onChanged(callback: (payload: MediaPreviewPayload) => void): () => void
  readonly windowControls: {
    readonly platform: DesktopPlatform
    getMaximized(): Promise<boolean>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    onMaximizedChange(callback: (maximized: boolean) => void): () => void
  }
}
