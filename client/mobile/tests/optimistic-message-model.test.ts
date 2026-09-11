import assert from "node:assert/strict"
import test from "node:test"

import type { ClientMessage } from "@/core/models"
import {
  createOptimisticBody,
  markOptimisticMessageFailed,
  mergeOptimisticMessages,
  reconcileOptimisticMessages,
  releaseAllDescriptorCleanups,
  releaseDescriptorCleanup,
} from "@/features/conversation/optimistic-message-model"

function message(id: string, clientMessageId: string, seq: number): ClientMessage {
  return {
    body: { content: id, type: "text" }, clientMessageId,
    conversationId: "conversation", createdAt: "2026-01-01T00:00:00Z", id,
    reactionVersion: 0, reactions: [], sender: { id: "me", type: "user" }, seq,
  }
}

test("正式消息按 clientMessageId 替换临时消息且不重复", () => {
  const pending = [{ descriptor: { clientMessageId: "a", content: "a", kind: "text" as const }, message: message("optimistic:a", "a", 2), status: "sending" as const }]
  const confirmed = [message("server-a", "a", 2)]
  assert.deepEqual(reconcileOptimisticMessages(pending, confirmed), [])
  assert.deepEqual(mergeOptimisticMessages(confirmed, pending).map((item) => item.id), ["server-a"])
})

test("HTTP 失败不能降级已经由实时通道确认的消息", () => {
  const pending = [{ descriptor: { clientMessageId: "a", content: "a", kind: "text" as const }, message: message("optimistic:a", "a", 2), status: "sending" as const }]
  assert.deepEqual(markOptimisticMessageFailed(pending, "a", [message("realtime-a", "a", 2)]), [])
})

test("失败消息保留上下文并可切换为失败状态", () => {
  const optimistic = message("optimistic:a", "a", 2)
  optimistic.replyToMessageId = "original"
  const result = markOptimisticMessageFailed([{ descriptor: { clientMessageId: "a", content: "a", kind: "text" }, message: optimistic, status: "sending" }], "a", [])
  assert.equal(result[0]?.status, "failed")
  assert.equal(result[0]?.message.replyToMessageId, "original")
})

test("临时文件 cleanup 所有权只释放一次且不处理无 cleanup 的原始文件", () => {
  let cleanupCount = 0
  const upload = { mimeType: "image/jpeg", name: "photo.jpg", sizeBytes: 123, uri: "file:///photo.jpg" }
  const descriptors = new Map([
    ["temporary", { cleanup: () => { cleanupCount += 1 }, clientMessageId: "temporary", kind: "image" as const, upload }],
    ["original", { clientMessageId: "original", kind: "file" as const, upload }],
  ])

  assert.equal(releaseDescriptorCleanup(descriptors, "temporary"), true)
  assert.equal(releaseDescriptorCleanup(descriptors, "temporary"), false)
  assert.equal(cleanupCount, 1)
  releaseAllDescriptorCleanups(descriptors)
  assert.equal(cleanupCount, 1)
  assert.equal(descriptors.size, 0)
})

test("批量 cleanup 在单项抛错时仍释放其余 descriptor", () => {
  let cleaned = false
  const upload = { mimeType: "image/jpeg", name: "photo.jpg", sizeBytes: 123, uri: "file:///photo.jpg" }
  const descriptors = new Map([
    ["throws", { cleanup: () => { throw new Error("failed") }, clientMessageId: "throws", kind: "image" as const, upload }],
    ["next", { cleanup: () => { cleaned = true }, clientMessageId: "next", kind: "image" as const, upload }],
  ])
  releaseAllDescriptorCleanups(descriptors)
  assert.equal(cleaned, true)
  assert.equal(descriptors.size, 0)
})

test("图片、视频、文件和语音临时正文保留本地 URI 与 metadata", () => {
  const upload = { mimeType: "image/jpeg", name: "photo.jpg", sizeBytes: 123, uri: "file:///photo.jpg" }
  assert.deepEqual(createOptimisticBody({ clientMessageId: "i", height: 20, kind: "image", upload, width: 10 }), { fileId: upload.uri, height: 20, type: "image", width: 10 })
  assert.deepEqual(createOptimisticBody({ clientMessageId: "f", kind: "file", upload }), { fileId: upload.uri, name: upload.name, sizeBytes: 123, type: "file" })
  assert.deepEqual(createOptimisticBody({ clientMessageId: "video", kind: "video", upload: { ...upload, mimeType: "video/mp4", name: "demo.mp4", uri: "file:///demo.mp4" } }), { contentType: "video/mp4", fileId: "file:///demo.mp4", name: "demo.mp4", sizeBytes: 123, type: "video" })
  assert.deepEqual(createOptimisticBody({ clientMessageId: "v", durationMS: 900, kind: "voice", transcript: "  hello  ", upload }), { contentType: upload.mimeType, durationMS: 900, fileId: upload.uri, sizeBytes: 123, transcript: "hello", type: "voice" })
})
