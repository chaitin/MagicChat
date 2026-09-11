import { describe, expect, it, vi } from "vitest"

import {
  formatClientMessageBodySummary,
  forwardConversationMessages,
  type ClientForwardBundleMessageBody,
} from "@/lib/client-data-api"

describe("message forwarding API", () => {
  it("sends one unified request and normalizes merged messages", async () => {
    const sourceConversationId = "11111111-1111-4111-8111-111111111111"
    const targetConversationId = "22222222-2222-4222-8222-222222222222"
    const messageIds = [
      "33333333-3333-4333-8333-333333333333",
      "77777777-7777-4777-8777-777777777777",
    ]
    const clientForwardId = "44444444-4444-4444-8444-444444444444"
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBeDefined()
        expect(init).toBeDefined()
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              failed_count: 0,
              results: [
                {
                  conversation_id: targetConversationId,
                  messages: [
                    {
                      body: {
                        item_count: 2,
                        items: [
                          {
                            body: { content: "第一条", type: "text" },
                            sender_name: "Alice",
                            sender_type: "user",
                            sent_at: "2026-07-13T10:00:00Z",
                            summary: "第一条",
                          },
                          {
                            body: {
                              item_count: 1,
                              items: [
                                {
                                  body: {
                                    file_id: "file-1",
                                    type: "image",
                                  },
                                  sender_name: "Carol",
                                  sender_type: "user",
                                  sent_at: "2026-07-13T09:59:00Z",
                                  summary: "[图片]",
                                },
                              ],
                              type: "forward_bundle",
                            },
                            sender_name: "Bob",
                            sender_type: "user",
                            sent_at: "2026-07-13T10:01:00Z",
                            summary: "[聊天记录] 1 条 - [图片]",
                          },
                        ],
                        type: "forward_bundle",
                      },
                      client_message_id: `forward:${clientForwardId}`,
                      conversation_id: targetConversationId,
                      created_at: "2026-07-13T10:02:00Z",
                      id: "55555555-5555-4555-8555-555555555555",
                      sender: {
                        id: "66666666-6666-4666-8666-666666666666",
                        type: "user",
                      },
                      seq: 1,
                    },
                  ],
                  status: "sent",
                },
              ],
              sent_count: 1,
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      }
    )

    const result = await forwardConversationMessages(
      sourceConversationId,
      {
        clientForwardId,
        messageIds,
        mode: "merged",
        targetConversationIds: [targetConversationId],
      },
      fetcher
    )

    expect(fetcher).toHaveBeenCalledWith(
      `/api/client/conversations/${sourceConversationId}/messages/forward`,
      expect.objectContaining({ method: "POST" })
    )
    const request = fetcher.mock.calls[0][1]
    expect(JSON.parse(String(request?.body))).toEqual({
      client_forward_id: clientForwardId,
      message_ids: messageIds,
      mode: "merged",
      target_conversation_ids: [targetConversationId],
    })
    expect(result.sentCount).toBe(1)
    expect(result.results[0].messages[0].body.type).toBe("forward_bundle")
    expect(
      formatClientMessageBodySummary(
        result.results[0].messages[0].body as ClientForwardBundleMessageBody
      )
    ).toBe("[聊天记录] 2 条 - 第一条")
    const bundle = result.results[0].messages[0]
      .body as ClientForwardBundleMessageBody
    expect(bundle.items[1].body.type).toBe("forward_bundle")
    expect(
      (bundle.items[1].body as ClientForwardBundleMessageBody).items[0].summary
    ).toBe("[图片]")
  })
})
