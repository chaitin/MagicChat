import { describe, expect, it, vi } from "vitest"

import { listConversationAttachments } from "@/lib/client-data-api"

describe("attachment client API", () => {
  it("lists and normalizes paginated conversation attachments", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          attachments: [
            {
              created_at: "2026-08-19T10:00:00Z",
              file_id: "file-1",
              message_id: "message-1",
              name: "设计文档.pdf",
              seq: 12,
              size_bytes: 1024,
            },
          ],
          next_cursor: "12",
        },
      })
    )

    const page = await listConversationAttachments(
      "conversation/1",
      { cursor: "20", limit: 25 },
      fetcher
    )

    expect(page).toEqual({
      attachments: [
        {
          createdAt: "2026-08-19T10:00:00Z",
          file: {
            fileId: "file-1",
            name: "设计文档.pdf",
            sizeBytes: 1024,
            type: "file",
          },
          messageId: "message-1",
          seq: 12,
        },
      ],
      nextCursor: "12",
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation%2F1/attachments?cursor=20&limit=25",
      { credentials: "include", method: "GET" }
    )
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
}
