import { File } from "expo-file-system"

import type { ResourceDownloadProgress } from "@/core/resource-models"

export class ResourceDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResourceDownloadError"
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  // React Native's AbortSignal does not implement the DOM throwIfAborted method.
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  throw error
}

export async function downloadResource({
  expectedSizeBytes,
  onProgress,
  signal,
  sourceUrl,
  temporaryFile,
}: {
  expectedSizeBytes?: number
  onProgress?: (progress: ResourceDownloadProgress) => void
  signal?: AbortSignal
  sourceUrl: string
  temporaryFile: File
}) {
  let responseSizeBytes: number | undefined

  try {
    throwIfAborted(signal)
    const downloaded = await File.downloadFileAsync(sourceUrl, temporaryFile, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes >= 0) responseSizeBytes = totalBytes
        if (!signal?.aborted) {
          onProgress?.({
            bytesWritten,
            totalBytes: totalBytes > 0 ? totalBytes : expectedSizeBytes,
          })
        }
      },
      signal,
    })
    throwIfAborted(signal)
    const actualSizeBytes = downloaded.size
    const validatedSizeBytes = expectedSizeBytes ?? responseSizeBytes

    validateSize(actualSizeBytes, validatedSizeBytes)

    onProgress?.({ bytesWritten: actualSizeBytes, totalBytes: actualSizeBytes })
    return { sizeBytes: actualSizeBytes }
  } catch (error: unknown) {
    deleteFileIfPresent(temporaryFile)
    throw error
  }
}

export async function downloadResourceBlob({
  expectedSizeBytes,
  mimeType,
  onProgress,
  signal,
  sourceUrl,
}: {
  expectedSizeBytes?: number
  mimeType?: string
  onProgress?: (progress: ResourceDownloadProgress) => void
  signal?: AbortSignal
  sourceUrl: string
}) {
  throwIfAborted(signal)
  const response = await fetch(sourceUrl, { signal })
  if (!response.ok) throw new ResourceDownloadError("视频下载失败，请重试")
  const headerSize = Number(response.headers.get("content-length"))
  const totalBytes = headerSize > 0 ? headerSize : expectedSizeBytes
  const reader = response.body?.getReader()
  let blob: Blob
  if (reader) {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let bytesWritten = 0
    try {
      while (true) {
        throwIfAborted(signal)
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(new Uint8Array(value))
        bytesWritten += value.byteLength
        onProgress?.({ bytesWritten, totalBytes })
      }
      blob = new Blob(chunks, { type: mimeType })
    } finally {
      if (signal?.aborted) await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  } else {
    blob = await response.blob()
  }
  throwIfAborted(signal)
  validateSize(blob.size, expectedSizeBytes ?? totalBytes)
  onProgress?.({ bytesWritten: blob.size, totalBytes: blob.size })
  throwIfAborted(signal)
  return { sizeBytes: blob.size, uri: URL.createObjectURL(blob) }
}

function validateSize(actual: number, expected?: number) {
  if (actual <= 0) throw new ResourceDownloadError("下载的资源为空")
  if (expected !== undefined && actual !== expected) {
    throw new ResourceDownloadError(`下载的资源不完整（应为 ${expected} 字节，实际为 ${actual} 字节）`)
  }
}

function deleteFileIfPresent(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // A failed temporary-file cleanup must not hide the download error.
  }
}
