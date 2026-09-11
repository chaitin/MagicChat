import { describe, expect, it } from "vitest"

import { normalizeClientMessageBody } from "./message-normalizers"

describe("voice message normalization", () => {
  it.each(["audio/webm", "audio/mp4"])(
    "accepts %s voice messages",
    (contentType) => {
      expect(
        normalizeClientMessageBody({
          content_type: contentType,
          duration_ms: 2_500,
          file_id: "voice-file",
          size_bytes: 4_096,
          transcript: "  识别文字  ",
          type: "voice",
        })
      ).toEqual({
        contentType,
        durationMS: 2_500,
        fileId: "voice-file",
        sizeBytes: 4_096,
        transcript: "识别文字",
        type: "voice",
      })
    }
  )

  it("rejects unsupported voice content types", () => {
    expect(
      normalizeClientMessageBody({
        content_type: "audio/mpeg",
        duration_ms: 2_500,
        file_id: "voice-file",
        size_bytes: 4_096,
        type: "voice",
      })
    ).toEqual({ type: "unsupported" })
  })
})
