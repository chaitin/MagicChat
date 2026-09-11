import type { Href } from "expo-router"

export type ImagePreviewSource =
  | { type: "attachment"; value: string }
  | { type: "avatar"; value: string }
  | { type: "url"; value: string }

export type ImagePreviewGalleryContext = {
  conversationId: string
  messageId: string
}

export function buildAttachmentImagePreviewHref(
  fileId: string,
  gallery?: ImagePreviewGalleryContext
): Href {
  return buildImagePreviewHref(
    { type: "attachment", value: fileId },
    gallery
  )
}

export function buildAvatarImagePreviewHref(avatar: string): Href {
  return buildImagePreviewHref({ type: "avatar", value: avatar })
}

export function buildUrlImagePreviewHref(url: string): Href {
  return buildImagePreviewHref({ type: "url", value: url })
}

export function parseImagePreviewSource(params: {
  fileId?: string | string[]
  source?: string | string[]
  sourceType?: string | string[]
}): ImagePreviewSource | null {
  const legacyFileId = getFirstParam(params.fileId).trim()
  if (legacyFileId) {
    return { type: "attachment", value: legacyFileId }
  }

  const type = getFirstParam(params.sourceType)
  const value = getFirstParam(params.source).trim()
  if (!value || (type !== "attachment" && type !== "avatar" && type !== "url")) {
    return null
  }

  if (type === "url" && !isHttpUrl(value)) return null
  if (type === "avatar" && !isAvatarSource(value)) return null
  return { type, value }
}

export function parseImagePreviewGalleryContext(params: {
  conversationId?: string | string[]
  messageId?: string | string[]
}): ImagePreviewGalleryContext | null {
  const conversationId = getFirstParam(params.conversationId).trim()
  const messageId = getFirstParam(params.messageId).trim()
  return conversationId && messageId ? { conversationId, messageId } : null
}

export function getImagePreviewSourceKey(source: ImagePreviewSource | null) {
  return source ? `${source.type}:${source.value}` : "invalid"
}

function buildImagePreviewHref(
  source: ImagePreviewSource,
  gallery?: ImagePreviewGalleryContext
): Href {
  return {
    pathname: "/image-preview",
    params: {
      source: source.value,
      sourceType: source.type,
      ...(gallery ?? {}),
    },
  } as unknown as Href
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isAvatarSource(value: string) {
  try {
    const url = new URL(value, "https://avatar.invalid/")
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
