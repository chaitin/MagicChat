import { afterEach, describe, expect, it, vi } from "vitest"

import {
  maximumDocumentImageBytes,
  resolveDocumentImageURLs,
  uploadDocumentImage,
} from "./document-image-api"

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("document image API", () => {
  it("uploads an image through the temporary file endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            file: {
              created_at: "2026-08-05T09:00:00Z",
              id: "550e8400-e29b-41d4-a716-446655440000",
              size_bytes: 4,
            },
          },
          success: true,
        },
        201
      )
    )
    const file = new File(["image"], "example.png", { type: "image/png" })

    await expect(uploadDocumentImage(file, fetcher)).resolves.toEqual({
      fileId: "550e8400-e29b-41d4-a716-446655440000",
      sizeBytes: 4,
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/temporary-files",
      expect.objectContaining({ credentials: "include", method: "POST" })
    )
    const body = fetcher.mock.calls[0]?.[1]?.body as FormData
    expect(body.get("file")).toBe(file)
  })

  it("resolves signed URLs and force-refreshes the shared cache", async () => {
    const fileId = "550e8400-e29b-41d4-a716-446655440010"
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            urls: [
              {
                expires_at: "2099-08-05T10:00:00Z",
                file_id: fileId,
                size_bytes: 4,
                url: "https://assets.example/first",
              },
            ],
          },
          success: true,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            urls: [
              {
                expires_at: "2099-08-05T11:00:00Z",
                file_id: fileId,
                size_bytes: 4,
                url: "https://assets.example/refreshed",
              },
            ],
          },
          success: true,
        })
      )
    vi.stubGlobal("fetch", fetcher)

    await expect(resolveDocumentImageURLs([fileId])).resolves.toMatchObject({
      urls: [{ url: "https://assets.example/first" }],
    })
    await expect(
      resolveDocumentImageURLs([fileId], true)
    ).resolves.toMatchObject({
      urls: [{ url: "https://assets.example/refreshed" }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("rejects unsupported and oversized images before uploading", async () => {
    const fetcher = vi.fn()
    await expect(
      uploadDocumentImage(
        new File(["svg"], "example.svg", { type: "image/svg+xml" }),
        fetcher
      )
    ).rejects.toThrow("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片")

    const oversized = new File(["image"], "large.png", { type: "image/png" })
    Object.defineProperty(oversized, "size", {
      value: maximumDocumentImageBytes + 1,
    })
    await expect(uploadDocumentImage(oversized, fetcher)).rejects.toThrow(
      "图片不能超过 10MiB"
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
