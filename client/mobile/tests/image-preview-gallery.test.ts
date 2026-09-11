import assert from "node:assert/strict"
import test from "node:test"

import type { ClientMessage } from "../src/core/models.ts"
import { buildImagePreviewGallery } from "../src/features/image-preview/image-preview-gallery.ts"

test("builds an oldest-to-newest gallery from image messages", () => {
  const messages = [
    createMessage("new-image", 30, "new-file"),
    createMessage("text", 20),
    createMessage("old-image", 10, "old-file"),
  ]

  assert.deepEqual(buildImagePreviewGallery(messages), [
    { fileId: "old-file", messageId: "old-image", seq: 10 },
    { fileId: "new-file", messageId: "new-image", seq: 30 },
  ])
})

function createMessage(id: string, seq: number, fileId?: string) {
  return {
    body: fileId
      ? { fileId, type: "image" as const }
      : { content: "hello", type: "text" as const },
    id,
    seq,
  } as ClientMessage
}
