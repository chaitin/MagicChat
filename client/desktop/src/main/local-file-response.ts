import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { AuthFailure } from "../shared/auth"

export function createLocalFileResponse(
  filePath: string,
  sizeBytes: number,
  contentType: string,
  rangeHeader?: string,
) {
  const range = parseRange(rangeHeader, sizeBytes)
  const stream = createReadStream(filePath, range ?? undefined)
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
  if (!range) {
    return new Response(body, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "private, no-store",
        "Content-Length": String(sizeBytes),
        "Content-Type": contentType,
      },
    })
  }
  const length = range.end - range.start + 1
  return new Response(body, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "private, no-store",
      "Content-Length": String(length),
      "Content-Range": `bytes ${range.start}-${range.end}/${sizeBytes}`,
      "Content-Type": contentType,
    },
  })
}

function parseRange(value: string | undefined, size: number) {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2])) {
    throw new AuthFailure("invalid_media_range", "媒体读取范围不正确")
  }
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new AuthFailure("invalid_media_range", "媒体读取范围不正确")
    }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new AuthFailure("invalid_media_range", "媒体读取范围不正确")
  }
  return { start, end: Math.min(end, size - 1) }
}
