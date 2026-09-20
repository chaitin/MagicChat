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
      typeof value.conversationName !== "string" ||
      !value.conversationName.trim() ||
      value.conversationName.length > ("avatar" in value ? 256 : 200)
    ) {
      throw new AuthFailure("invalid_media_preview", "媒体预览请求不正确")
    }
    if ("avatar" in value) {
      const avatar = value.avatar
      if (
        !avatar ||
        !["user", "app", "group"].includes(avatar.type) ||
        typeof avatar.id !== "string" ||
        !avatar.id ||
        avatar.id.length > 128 ||
        (avatar.theme !== "light" && avatar.theme !== "dark")
      ) {
        throw new AuthFailure("invalid_media_preview", "头像预览请求不正确")
      }
      const resolved = await auth.getAvatar({
        targetId: value.targetId,
        type: avatar.type,
        id: avatar.id,
        theme: avatar.theme,
      })
      if (resolved.status !== "ready" || !resolved.resourceUrl) {
        throw new AuthFailure("avatar_not_found", "暂无可预览的头像")
      }
      const url = new URL(resolved.resourceUrl)
      if (
        url.protocol !== "jiying-avatar:" ||
        url.hostname !== "cache" ||
        !/^\/[a-f0-9]{64}$/.test(url.pathname)
      ) {
        throw new AuthFailure("invalid_avatar", "头像资源不正确")
      }
      const resource = await auth.readAvatarResource(url.pathname.slice(1))
      mediaPreview.open({
        title: value.conversationName.trim(),
        category: "image",
        contentType: resource.contentType,
        originalName: `${value.conversationName.trim()}头像`,
        resourceUrl: resolved.resourceUrl,
      })
      return null
    }
    if (typeof value.cacheKey !== "string") {
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
