import { describe, expect, it } from "vitest"

import {
  getVideoMessageUploadError,
  isAcceptedVideoMessageFile,
  videoMessageMaxBytes,
} from "@/lib/video-message"

describe("video message validation", () => {
  it("accepts MP4 and WebM files", () => {
    expect(
      isAcceptedVideoMessageFile(
        new File(["video"], "demo.mp4", { type: "video/mp4" })
      )
    ).toBe(true)
    expect(
      isAcceptedVideoMessageFile(
        new File(["video"], "demo.webm", { type: "video/webm" })
      )
    ).toBe(true)
  })

  it("rejects empty, oversized, and unsupported files", () => {
    expect(
      getVideoMessageUploadError(
        new File([], "empty.mp4", { type: "video/mp4" })
      )
    ).toBe("视频不能为空")
    const oversized = new File(["x"], "large.mp4", { type: "video/mp4" })
    Object.defineProperty(oversized, "size", {
      value: videoMessageMaxBytes + 1,
    })
    expect(getVideoMessageUploadError(oversized)).toBe(
      "视频大于 100MiB，无法上传"
    )
    expect(
      getVideoMessageUploadError(
        new File(["text"], "notes.txt", { type: "text/plain" })
      )
    ).toBe("视频必须是 MP4 或 WebM 格式")
  })
})
