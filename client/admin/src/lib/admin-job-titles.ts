import { adminFetch } from "@/lib/auth"

export async function listJobTitles(keyword: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ keyword: keyword.trim() })
  const response = await adminFetch(`/api/admin/users/job-titles?${params}`, {
    method: "GET",
    credentials: "include",
    signal,
  })
  if (!response.ok) throw new Error("加载历史职务失败")
  const payload = (await response.json()) as {
    success?: boolean
    data?: { titles?: string[] }
  }
  if (payload.success === false || !Array.isArray(payload.data?.titles)) {
    throw new Error("历史职务响应格式不正确")
  }
  return [
    ...new Set(
      payload.data.titles
        .filter((title) => typeof title === "string")
        .map((title) => title.trim())
        .filter(Boolean)
    ),
  ]
}
