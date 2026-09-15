import { describe, expect, it, vi } from "vitest"

import { listAdminApps } from "@/lib/admin-apps"

describe("admin apps", () => {
  it("includes creator details when listing apps", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            apps: [
              {
                avatar: "",
                connection_secret: "secret",
                connection_status: "offline",
                created_at: "2026-07-20T02:00:00Z",
                creator: {
                  avatar: "/assets/avatars/builtin/02.webp",
                  email: "zhangsan@example.com",
                  id: "user-1",
                  name: "张三",
                  nickname: "小张",
                },
                creator_user_id: "user-1",
                description: "回答知识库问题",
                enabled: true,
                id: "app-1",
                name: "知识库助手",
                system: false,
                updated_at: "2026-07-20T02:00:00Z",
                visibility: "creator",
              },
            ],
          },
          success: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    )

    await expect(listAdminApps(fetcher)).resolves.toEqual([
      expect.objectContaining({
        creator: {
          avatar: "/assets/avatars/builtin/02.webp",
          email: "zhangsan@example.com",
          id: "user-1",
          name: "张三",
          nickname: "小张",
        },
        creatorUserId: "user-1",
        id: "app-1",
      }),
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/admin/apps", {
      credentials: "include",
      method: "GET",
    })
  })
})
