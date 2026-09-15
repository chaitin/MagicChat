import { describe, expect, it, vi } from "vitest"

import { listAdminReports } from "@/lib/admin-reports"

describe("admin reports", () => {
  it("loads paginated report history", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            page: 1,
            page_size: 20,
            total: 1,
            reports: [
              {
                id: "report-1",
                conversation_id: "conversation-1",
                reason: "harassment_or_abuse",
                description: "持续发送辱骂内容",
                created_at: "2026-09-07T08:00:00Z",
                reported_user: {
                  id: "user-2",
                  name: "张三",
                  status: "active",
                },
                reporter_user: {
                  id: "user-1",
                  name: "李四",
                  status: "active",
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    await expect(
      listAdminReports({ page: 1, pageSize: 20 }, fetcher)
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      reports: [
        {
          id: "report-1",
          reason: "harassment_or_abuse",
          reportedUser: { id: "user-2", name: "张三" },
          reporterUser: { id: "user-1", name: "李四" },
        },
      ],
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/reports?page=1&page_size=20",
      { credentials: "include", method: "GET" }
    )
  })

  it("rejects malformed report history", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { reports: [{}] } }), {
        status: 200,
      })
    )
    await expect(listAdminReports({}, fetcher)).rejects.toThrow(
      "举报记录响应格式不正确"
    )
  })
})
