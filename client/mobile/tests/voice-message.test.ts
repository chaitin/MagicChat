import assert from "node:assert/strict"
import test from "node:test"

import { normalizeClientMessage } from "../src/data/messages/message-normalizer.ts"
import { createVoiceMessageExtraFields } from "../src/data/messages/message-upload.ts"
import {
  getAttachmentCacheExtension,
  hasExpectedVoiceCacheExtension,
} from "../src/data/resources/resource-file-extension.ts"
import { collectMessageResources } from "../src/domain/messages/message-presenter.ts"
import { getVoiceRecordingFormat } from "../src/domain/audio/voice-recording-format.ts"

test("uses M4A/AAC natively and WebM/Opus on web", () => {
  assert.deepEqual(getVoiceRecordingFormat("android"), {
    extension: ".m4a",
    mimeType: "audio/mp4",
  })
  assert.deepEqual(getVoiceRecordingFormat("ios"), {
    extension: ".m4a",
    mimeType: "audio/mp4",
  })
  assert.deepEqual(getVoiceRecordingFormat("web"), {
    extension: ".webm",
    mimeType: "audio/webm",
  })
})

test("trims and uploads a voice transcript when present", () => {
  assert.deepEqual(createVoiceMessageExtraFields(2_500, "  你好  "), {
    duration_ms: "2500",
    transcript: "你好",
  })
  assert.deepEqual(createVoiceMessageExtraFields(2_500, "  "), {
    duration_ms: "2500",
  })
})

test("normalizes M4A voice messages and uses an m4a cache name", () => {
  const message = normalizeClientMessage({
    body: {
      content_type: "audio/mp4",
      duration_ms: 2_500,
      file_id: "voice-file",
      size_bytes: 4_096,
      transcript: "识别文字",
      type: "voice",
    },
    conversation_id: "conversation",
    created_at: "2026-07-30T00:00:00Z",
    id: "message",
    sender: { id: "user", type: "user" },
    seq: 1,
  })

  assert.equal(message.body.type, "voice")
  const [resource] = collectMessageResources([message])
  assert.equal(resource?.fileName, "voice.m4a")
  assert.equal(resource?.mimeType, "audio/mp4")
  assert.equal(resource && getAttachmentCacheExtension(resource, ""), ".m4a")
  assert.equal(
    resource && hasExpectedVoiceCacheExtension(resource, "file:///voice.webm"),
    false
  )
  assert.equal(
    resource && hasExpectedVoiceCacheExtension(resource, "file:///voice.m4a"),
    true
  )
})

test("keeps WebM voice resources in WebM cache files", () => {
  const resource = {
    fileId: "voice-file",
    fileName: "voice.webm",
    kind: "voice",
    mimeType: "audio/webm",
    type: "attachment",
  } as const

  assert.equal(getAttachmentCacheExtension(resource, ""), ".webm")
  assert.equal(hasExpectedVoiceCacheExtension(resource, "file:///voice.webm"), true)
})

test("rejects unsupported voice content types", () => {
  const message = normalizeClientMessage({
    body: {
      content_type: "audio/mpeg",
      duration_ms: 2_500,
      file_id: "voice-file",
      size_bytes: 4_096,
      type: "voice",
    },
    conversation_id: "conversation",
    created_at: "2026-07-30T00:00:00Z",
    id: "message",
    sender: { id: "user", type: "user" },
    seq: 1,
  })

  assert.deepEqual(message.body, { type: "unsupported" })
})
