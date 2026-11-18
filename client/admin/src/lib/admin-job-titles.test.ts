import { afterEach, describe, expect, it, vi } from "vitest"
import { listJobTitles } from "./admin-job-titles"

const adminFetch = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({ adminFetch }))
afterEach(() => vi.resetAllMocks())

describe("job title suggestions", () => {
  it("queries the keyword and deduplicates saved titles", async () => {
    adminFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { titles: [" 工程师 ", "工程师", "", "高级工程师"] },
        })
      )
    )
    expect(await listJobTitles(" 工程 ")).toEqual(["工程师", "高级工程师"])
    expect(adminFetch.mock.calls[0][0]).toBe(
      "/api/admin/users/job-titles?keyword=%E5%B7%A5%E7%A8%8B"
    )
  })
  it("rejects failed or malformed responses", async () => {
    adminFetch.mockResolvedValue(new Response("{}", { status: 500 }))
    await expect(listJobTitles("")).rejects.toThrow("加载历史职务失败")
    adminFetch.mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    await expect(listJobTitles("")).rejects.toThrow("历史职务响应格式不正确")
  })
})
