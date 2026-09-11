import type { AttachmentResourceReference } from "@/core/resource-models"

export function getAttachmentCacheExtension(
  reference: AttachmentResourceReference,
  sourceUrl: string
) {
  if (reference.kind === "image") return ".webp"
  if (reference.kind === "voice") {
    if (reference.mimeType === "audio/mp4") return ".m4a"
    if (reference.mimeType === "audio/webm") return ".webm"
    return (
      getPathExtension(reference.fileName ?? "") ||
      getUrlExtension(sourceUrl, ".webm")
    )
  }

  const fileNameExtension = getPathExtension(reference.fileName ?? "")
  return fileNameExtension || getUrlExtension(sourceUrl, ".file")
}

export function hasExpectedVoiceCacheExtension(
  reference: AttachmentResourceReference,
  uri: string
) {
  return (
    reference.kind !== "voice" ||
    getPathExtension(uri) === getAttachmentCacheExtension(reference, "")
  )
}

function getUrlExtension(value: string, fallback: string) {
  try {
    return getPathExtension(new URL(value).pathname) || fallback
  } catch {
    return fallback
  }
}

function getPathExtension(value: string) {
  const match = /\.[a-zA-Z0-9]{1,10}$/.exec(value)
  return match ? match[0].toLowerCase() : ""
}
