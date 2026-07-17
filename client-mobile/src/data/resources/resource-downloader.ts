import { File } from "expo-file-system"

export class ResourceDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResourceDownloadError"
  }
}

export async function downloadResource({
  expectedSizeBytes,
  signal,
  sourceUrl,
  temporaryFile,
}: {
  expectedSizeBytes?: number
  signal?: AbortSignal
  sourceUrl: string
  temporaryFile: File
}) {
  let responseSizeBytes: number | undefined

  try {
    const downloaded = await File.downloadFileAsync(sourceUrl, temporaryFile, {
      idempotent: true,
      onProgress: ({ totalBytes }) => {
        if (totalBytes >= 0) responseSizeBytes = totalBytes
      },
      signal,
    })
    const actualSizeBytes = downloaded.size
    const validatedSizeBytes = expectedSizeBytes ?? responseSizeBytes

    if (actualSizeBytes <= 0) {
      throw new ResourceDownloadError("下载的资源为空")
    }

    if (
      validatedSizeBytes !== undefined &&
      actualSizeBytes !== validatedSizeBytes
    ) {
      throw new ResourceDownloadError(
        `下载的资源不完整（应为 ${validatedSizeBytes} 字节，实际为 ${actualSizeBytes} 字节）`
      )
    }

    return { sizeBytes: actualSizeBytes }
  } catch (error: unknown) {
    deleteFileIfPresent(temporaryFile)
    throw error
  }
}

function deleteFileIfPresent(file: File) {
  try {
    if (file.exists) file.delete()
  } catch {
    // A failed temporary-file cleanup must not hide the download error.
  }
}
