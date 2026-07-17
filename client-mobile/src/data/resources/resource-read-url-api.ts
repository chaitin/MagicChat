import { ApiRequestError, createApiClient } from "@/data/api-client"

export type ResourceReadUrl = {
  expiresAt: string
  fileId: string
  sizeBytes: number | null
  url: string
}

export async function fetchResourceReadUrls(
  serverUrl: string,
  fileIds: string[],
  options: { signal?: AbortSignal } = {}
): Promise<ResourceReadUrl[]> {
  if (fileIds.length === 0) return []

  const data = await createApiClient(serverUrl).request<{
    urls?: unknown[]
  }>("/api/client/temporary-files/read-urls", {
    body: JSON.stringify({ file_ids: Array.from(new Set(fileIds)) }),
    errorMessage: "获取文件访问地址失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  if (!Array.isArray(data?.urls)) {
    throw new ApiRequestError("文件访问地址响应格式不正确")
  }

  return data.urls.map(normalizeResourceReadUrl)
}

function normalizeResourceReadUrl(value: unknown): ResourceReadUrl {
  const item = asRecord(value)
  const expiresAt = asString(item?.expires_at)
  const fileId = asString(item?.file_id)
  const sizeBytes = asNumber(item?.size_bytes)
  const url = asString(item?.url)

  if (
    !item ||
    !expiresAt ||
    !fileId ||
    (sizeBytes !== undefined && sizeBytes < 0) ||
    !url
  ) {
    throw new ApiRequestError("文件访问地址响应格式不正确")
  }

  return { expiresAt, fileId, sizeBytes: sizeBytes ?? null, url }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined
}
