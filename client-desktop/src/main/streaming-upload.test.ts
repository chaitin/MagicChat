import { describe, expect, it } from "vitest"

import { MultipartFileSizeGuard } from "@main/streaming-upload"

describe("MultipartFileSizeGuard", () => {
  it("accepts a non-empty file exactly at the limit across arbitrary chunks", () => {
    const boundary = "magicchat-boundary"
    const payload = createMultipart(boundary, [
      { name: "client_message_id", value: "message-1" },
      { filename: "notes.txt", name: "file", value: "12345" },
    ])
    const guard = new MultipartFileSizeGuard(boundary, 5)

    for (const byte of payload) guard.push(Uint8Array.of(byte))

    expect(() => guard.finish()).not.toThrow()
  })

  it("rejects a file over the limit without counting other fields", () => {
    const boundary = "magicchat-boundary"
    const payload = createMultipart(boundary, [
      { name: "client_message_id", value: "a-long-client-message-id" },
      { filename: "notes.txt", name: "file", value: "123456" },
    ])
    const guard = new MultipartFileSizeGuard(boundary, 5)

    expect(() => guard.push(payload)).toThrow("上传文件超过 500 MiB 限制")
  })

  it("rejects empty, duplicate, and malformed file parts", () => {
    const boundary = "magicchat-boundary"
    const empty = new MultipartFileSizeGuard(boundary, 5)
    empty.push(createMultipart(boundary, [{ filename: "empty.txt", name: "file", value: "" }]))
    expect(() => empty.finish()).toThrow("文件不能为空")

    const duplicate = new MultipartFileSizeGuard(boundary, 5)
    expect(() =>
      duplicate.push(
        createMultipart(boundary, [
          { filename: "one.txt", name: "file", value: "1" },
          { filename: "two.txt", name: "file", value: "2" },
        ]),
      ),
    ).toThrow("文件上传内容格式无效")

    const malformed = new MultipartFileSizeGuard(boundary, 5)
    malformed.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\n1`),
    )
    expect(() => malformed.finish()).toThrow("文件上传内容格式无效")
  })

  it("treats boundary prefixes with invalid suffixes as file content", () => {
    const boundary = "magicchat-boundary"
    const value = `before\r\n--${boundary}-not-a-delimiter\r\nafter`
    const payload = createMultipart(boundary, [{ filename: "notes.txt", name: "file", value }])
    const guard = new MultipartFileSizeGuard(boundary, Buffer.byteLength(value, "latin1"))

    for (const byte of payload) guard.push(Uint8Array.of(byte))

    expect(() => guard.finish()).not.toThrow()
  })
})

function createMultipart(
  boundary: string,
  parts: Array<{ filename?: string; name: string; value: string }>,
) {
  const sections = parts.map(({ filename, name, value }) => {
    const disposition = filename
      ? `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream`
      : `Content-Disposition: form-data; name="${name}"`
    return `--${boundary}\r\n${disposition}\r\n\r\n${value}\r\n`
  })
  return Buffer.from(`${sections.join("")}--${boundary}--\r\n`, "latin1")
}
