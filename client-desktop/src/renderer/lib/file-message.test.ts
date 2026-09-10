import { describe, expect, it } from "vitest"

import { fileMessageMaxBytes, getFileMessageUploadError } from "@/lib/file-message"

describe("file message validation", () => {
  it("rejects empty and oversized files", () => {
    expect(getFileMessageUploadError({ size: 0 })).toBe("文件不能为空")
    expect(getFileMessageUploadError({ size: fileMessageMaxBytes + 1 })).toBe("文件不能超过 500MiB")
  })

  it("accepts files through the 500 MiB boundary", () => {
    expect(getFileMessageUploadError({ size: 1 })).toBeNull()
    expect(getFileMessageUploadError({ size: 20 * 1024 * 1024 + 1 })).toBeNull()
    expect(fileMessageMaxBytes).toBe(500 * 1024 * 1024)
    expect(getFileMessageUploadError({ size: 500 * 1024 * 1024 })).toBeNull()
  })
})
