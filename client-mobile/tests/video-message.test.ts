import assert from "node:assert/strict"
import test from "node:test"

import { normalizeClientMessage } from "@/data/messages/message-normalizer"
import {
  collectMessageResources,
  formatClientMessageBodySummary,
} from "@/domain/messages/message-presenter"

const message = normalizeClientMessage({
  body: {
    caption: " **视频说明** ",
    caption_type: "markdown",
    content_type: "video/mp4",
    file_id: "video-1",
    name: "demo.mp4",
    size_bytes: 1024,
    type: "video",
  },
  client_message_id: "client-video",
  conversation_id: "conversation-1",
  created_at: "2026-09-10T08:00:00Z",
  id: "message-video",
  sender: { id: "user-1", type: "user" },
  seq: 1,
})

test("标准化视频消息并生成说明摘要", () => {
  assert.deepEqual(message.body, {
    caption: "**视频说明**",
    captionType: "markdown",
    contentType: "video/mp4",
    fileId: "video-1",
    name: "demo.mp4",
    sizeBytes: 1024,
    type: "video",
  })
  assert.equal(
    formatClientMessageBodySummary(message.body, () => undefined),
    "[视频] 视频说明"
  )
})

test("视频消息注册为流式视频资源", () => {
  assert.deepEqual(collectMessageResources([message]), [
    {
      expectedSizeBytes: 1024,
      fileId: "video-1",
      fileName: "demo.mp4",
      kind: "video",
      mimeType: "video/mp4",
      type: "attachment",
    },
  ])
})

test("将服务端返回的不支持视频格式降级为未知消息", () => {
  const unsupported = normalizeClientMessage({
    body: {
      content_type: "video/quicktime",
      file_id: "video-1",
      name: "demo.mov",
      size_bytes: 1024,
      type: "video",
    },
    client_message_id: "client-video",
    conversation_id: "conversation-1",
    created_at: "2026-09-10T08:00:00Z",
    id: "message-video",
    sender: { id: "user-1", type: "user" },
    seq: 1,
  })

  assert.deepEqual(unsupported.body, { type: "unsupported" })
})
