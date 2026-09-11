import {
  ClientDataRequestError,
  createRequestError,
  readJson,
} from "@/lib/client-api/core"
import type {
  ClientDataFetch,
  ClientDataErrorEnvelope,
  ClientDataSuccessEnvelope,
  TemporaryFileReadURL,
} from "@/lib/client-api/types"
import {
  invalidateTemporaryFileReadURLCache,
  readTemporaryFileURLs,
} from "@/lib/client-api/messages"

export const maximumDocumentImageBytes = 10 * 1024 * 1024
const allowedDocumentImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])
const maximumResolveBatchSize = 100

type UploadTemporaryFileResponse = {
  file?: {
    created_at?: string
    id?: string
    size_bytes?: number
  }
}

export type UploadedDocumentImage = {
  fileId: string
  sizeBytes: number
}

export async function uploadDocumentImage(
  file: File,
  fetcher: ClientDataFetch = fetch
): Promise<UploadedDocumentImage> {
  if (!allowedDocumentImageTypes.has(file.type)) {
    throw new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片")
  }
  if (file.size <= 0) throw new Error("图片内容为空")
  if (file.size > maximumDocumentImageBytes) {
    throw new Error("图片不能超过 10MiB")
  }

  const body = new FormData()
  body.set("file", file)
  const response = await fetcher("/api/client/temporary-files", {
    body,
    credentials: "include",
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<UploadTemporaryFileResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "上传图片失败")
  }
  const uploaded = (
    payload as
      ClientDataSuccessEnvelope<UploadTemporaryFileResponse> | undefined
  )?.data?.file
  if (
    typeof uploaded?.id !== "string" ||
    typeof uploaded.size_bytes !== "number"
  ) {
    throw new Error("图片上传响应格式不正确")
  }
  return { fileId: uploaded.id, sizeBytes: uploaded.size_bytes }
}

export async function resolveDocumentImageURLs(
  fileIds: string[],
  forceRefresh = false
): Promise<{ missingFileIds: string[]; urls: TemporaryFileReadURL[] }> {
  const uniqueFileIds = Array.from(new Set(fileIds))
  if (forceRefresh) invalidateTemporaryFileReadURLCache(uniqueFileIds)

  const missingFileIds: string[] = []
  const urls: TemporaryFileReadURL[] = []
  for (
    let index = 0;
    index < uniqueFileIds.length;
    index += maximumResolveBatchSize
  ) {
    const batch = uniqueFileIds.slice(index, index + maximumResolveBatchSize)
    try {
      urls.push(...(await readTemporaryFileURLs(batch)))
    } catch (error) {
      if (!(error instanceof ClientDataRequestError) || error.status !== 404) {
        throw error
      }
      for (const fileId of batch) {
        try {
          urls.push(...(await readTemporaryFileURLs([fileId])))
        } catch (fileError) {
          if (
            fileError instanceof ClientDataRequestError &&
            fileError.status === 404
          ) {
            missingFileIds.push(fileId)
          } else {
            throw fileError
          }
        }
      }
    }
  }
  return { missingFileIds, urls }
}
