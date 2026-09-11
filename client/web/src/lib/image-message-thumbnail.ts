import type { ClientImageMessageBody } from "@/lib/client-data-api"

export type ImageThumbnailFrame = {
  height: number
  width: number
}

const legacyImageThumbnailSize = 256
const minImageThumbnailWidth = 160
const maxImageThumbnailWidth = 320
const maxImageThumbnailHeight = 360

export function getImageThumbnailFrame(
  image: ClientImageMessageBody
): ImageThumbnailFrame {
  if (!image.width || !image.height) {
    return {
      height: legacyImageThumbnailSize,
      width: legacyImageThumbnailSize,
    }
  }

  const width = Math.min(
    maxImageThumbnailWidth,
    Math.max(minImageThumbnailWidth, image.width)
  )
  const height = Math.min(
    maxImageThumbnailHeight,
    (image.height * width) / image.width
  )

  return {
    height: Math.max(1, Math.round(height)),
    width: Math.max(1, Math.round(width)),
  }
}
