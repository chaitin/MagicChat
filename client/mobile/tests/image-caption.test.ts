import assert from "node:assert/strict"
import test from "node:test"

import { normalizeClientMessage } from "../src/data/messages/message-normalizer.ts"
import { formatClientMessageBodySummary } from "../src/domain/messages/message-presenter.ts"

const baseMessage = {
  conversation_id: "conversation",
  created_at: "2026-07-30T00:00:00Z",
  id: "message",
  sender: { id: "app", type: "app" },
  seq: 1,
}

const mentionedUserId = "11111111-1111-4111-8111-111111111111"
const resolveMentionLabel = ({ id }: { id: string }) =>
  id === mentionedUserId ? "小明" : undefined

test("normalizes markdown image captions and includes them in summaries", () => {
  const message = normalizeClientMessage({
    ...baseMessage,
    body: {
      caption: "  **图片说明**  ",
      caption_type: "markdown",
      file_id: "image-1",
      height: 240,
      type: "image",
      width: 320,
    },
  })

  assert.deepEqual(message.body, {
    caption: "**图片说明**",
    captionType: "markdown",
    fileId: "image-1",
    height: 240,
    type: "image",
    width: 320,
  })
  assert.equal(
    formatClientMessageBodySummary(message.body, resolveMentionLabel),
    "[图片] 图片说明"
  )
})

test("defaults image captions to text and resolves mentions in summaries", () => {
  const message = normalizeClientMessage({
    ...baseMessage,
    body: {
      caption: `请看 {(@user/${mentionedUserId})}`,
      file_id: "image-1",
      type: "image",
    },
  })

  assert.equal(message.body.type, "image")
  if (message.body.type !== "image") return
  assert.equal(message.body.captionType, "text")
  assert.equal(
    formatClientMessageBodySummary(message.body, resolveMentionLabel),
    "[图片] 请看 @小明"
  )
})

test("omits blank image captions", () => {
  const message = normalizeClientMessage({
    ...baseMessage,
    body: {
      caption: "   ",
      caption_type: "markdown",
      file_id: "image-1",
      type: "image",
    },
  })

  assert.deepEqual(message.body, { fileId: "image-1", type: "image" })
  assert.equal(
    formatClientMessageBodySummary(message.body, resolveMentionLabel),
    "[图片]"
  )
})
