import { describe, expect, it, vi } from "vitest"

import { searchClientMessages } from "./search"

describe("client message search API", () => {
  it("sends optional filters and normalizes message results", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        data: {
          items: [
            {
              conversation: {
                avatar: "/groups/release.webp",
                id: "conversation-1",
                name: "发布群",
                type: "group",
              },
              message: {
                body: { content: "发布计划已确认", type: "text" },
                conversation_id: "conversation-1",
                created_at: "2026-07-29T10:00:00Z",
                id: "message-1",
                sender: { id: "user-1", type: "user" },
                sender_name: "张三",
                seq: 12,
                summary: "发布计划已确认",
              },
            },
          ],
        },
        success: true,
      })
    )
    const controller = new AbortController()

    const results = await searchClientMessages(
      {
        conversationId: "conversation-1",
        from: "2026-07-01T00:00:00Z",
        keyword: " 发布计划 ",
        senderId: "user-1",
        signal: controller.signal,
        to: "2026-07-29T00:00:00Z",
      },
      fetcher
    )

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/search/messages?keyword=%E5%8F%91%E5%B8%83%E8%AE%A1%E5%88%92&conversation_id=conversation-1&sender_id=user-1&from=2026-07-01T00%3A00%3A00Z&to=2026-07-29T00%3A00%3A00Z",
      {
        credentials: "include",
        method: "GET",
        signal: controller.signal,
      }
    )
    expect(results).toEqual([
      expect.objectContaining({
        conversation: {
          avatar: "/groups/release.webp",
          id: "conversation-1",
          name: "发布群",
          type: "group",
        },
        message: expect.objectContaining({
          conversationId: "conversation-1",
          id: "message-1",
          seq: 12,
        }),
        senderName: "张三",
        summary: "发布计划已确认",
      }),
    ])
  })

  it("preserves server timeout errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "search_timeout",
            message: "搜索超时，请缩小搜索范围后重试",
          },
          success: false,
        },
        { status: 503 }
      )
    )

    await expect(
      searchClientMessages({ keyword: "发布计划" }, fetcher)
    ).rejects.toMatchObject({
      code: "search_timeout",
      message: "搜索超时，请缩小搜索范围后重试",
      status: 503,
    })
  })
})
