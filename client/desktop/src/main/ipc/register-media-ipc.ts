import { AuthFailure } from "../../shared/auth"
import {
  MEDIA_CHANNELS,
  type MediaCacheRequest,
  type MediaPreviewRequest,
} from "../../shared/media"
import type { AuthController } from "../auth-controller"
import type { MediaPreviewWindow } from "../media-preview-window"
import type { IpcRegistrar } from "./register-account-data-ipc"

export function registerMediaIpc({
  handle,
  auth,
  mediaPreview,
}: {
  handle: IpcRegistrar
  auth: AuthController
  mediaPreview: MediaPreviewWindow
}) {
  handle(MEDIA_CHANNELS.ensureCached, (input) => auth.ensureMediaCached(input as MediaCacheRequest))
  handle(MEDIA_CHANNELS.openPreview, async (input) => {
    const value = input as MediaPreviewRequest | undefined
    if (
      !value ||
      typeof value.targetId !== "string" ||
      typeof value.cacheKey !== "string" ||
      typeof value.conversationName !== "string" ||
      !value.conversationName.trim() ||
      value.conversationName.length > 200
    ) {
      throw new AuthFailure("invalid_media_preview", "媒体预览请求不正确")
    }
    const cached = value.cacheKey.startsWith("outgoing:")
      ? await auth
          .getOutgoingMedia(value.targetId, value.cacheKey.slice("outgoing:".length))
          .then((media) => ({
            cacheKey: value.cacheKey,
            category: media.category,
            contentType: media.contentType,
            originalName: media.name,
            resourceUrl: `jiying-media://outgoing/${encodeURIComponent(value.targetId)}/${encodeURIComponent(value.cacheKey.slice("outgoing:".length))}`,
            sizeBytes: media.sizeBytes,
          }))
      : await auth.getCachedMedia(value.targetId, value.cacheKey)
    if (cached.category === "attachment") {
      throw new AuthFailure("unsupported_media_preview", "该文件类型不支持预览")
    }
    mediaPreview.open({
      title: value.conversationName.trim(),
      category: cached.category,
      contentType: cached.contentType,
      originalName: cached.originalName,
      resourceUrl: cached.resourceUrl,
    })
    return null
  })
}
