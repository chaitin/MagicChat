import type { ClientMessage } from "@/core/models"

export type ImagePreviewGalleryItem = {
  fileId: string
  messageId: string
  seq: number
}

export function buildImagePreviewGallery(
  messages: ClientMessage[]
): ImagePreviewGalleryItem[] {
  const imagesByMessageId = new Map<string, ImagePreviewGalleryItem>()

  for (const message of messages) {
    if (message.body.type !== "image") continue
    imagesByMessageId.set(message.id, {
      fileId: message.body.fileId,
      messageId: message.id,
      seq: message.seq,
    })
  }

  return Array.from(imagesByMessageId.values()).sort(
    (left, right) => left.seq - right.seq
  )
}
