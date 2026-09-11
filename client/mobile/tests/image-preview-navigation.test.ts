import assert from "node:assert/strict"
import test from "node:test"

import {
  buildAttachmentImagePreviewHref,
  buildAvatarImagePreviewHref,
  buildUrlImagePreviewHref,
  parseImagePreviewGalleryContext,
  parseImagePreviewSource,
} from "../src/navigation/image-preview.ts"

test("builds preview routes for every supported image source", () => {
  assert.deepEqual(buildAttachmentImagePreviewHref("file-1"), {
    pathname: "/image-preview",
    params: { source: "file-1", sourceType: "attachment" },
  })
  assert.deepEqual(buildAvatarImagePreviewHref("/avatars/user.png"), {
    pathname: "/image-preview",
    params: { source: "/avatars/user.png", sourceType: "avatar" },
  })
  assert.deepEqual(buildUrlImagePreviewHref("https://example.com/image.png"), {
    pathname: "/image-preview",
    params: {
      source: "https://example.com/image.png",
      sourceType: "url",
    },
  })
})

test("parses current and legacy preview route parameters", () => {
  assert.deepEqual(
    parseImagePreviewSource({ source: "file-2", sourceType: "attachment" }),
    { type: "attachment", value: "file-2" }
  )
  assert.deepEqual(parseImagePreviewSource({ fileId: ["legacy-file"] }), {
    type: "attachment",
    value: "legacy-file",
  })
})

test("carries conversation context for an image-message gallery", () => {
  assert.deepEqual(
    buildAttachmentImagePreviewHref("file-3", {
      conversationId: "conversation-1",
      messageId: "message-3",
    }),
    {
      pathname: "/image-preview",
      params: {
        conversationId: "conversation-1",
        messageId: "message-3",
        source: "file-3",
        sourceType: "attachment",
      },
    }
  )
  assert.deepEqual(
    parseImagePreviewGalleryContext({
      conversationId: "conversation-1",
      messageId: ["message-3"],
    }),
    { conversationId: "conversation-1", messageId: "message-3" }
  )
  assert.equal(
    parseImagePreviewGalleryContext({ conversationId: "conversation-1" }),
    null
  )
})

test("rejects invalid remote preview sources", () => {
  assert.equal(
    parseImagePreviewSource({ source: "file:///private/image.png", sourceType: "url" }),
    null
  )
  assert.equal(
    parseImagePreviewSource({ source: "https://example.com/image.png" }),
    null
  )
  assert.equal(
    parseImagePreviewSource({ source: "file:///private/avatar.png", sourceType: "avatar" }),
    null
  )
})
