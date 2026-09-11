import { describe, expect, it, vi } from "vitest"

import { sendConversationChartMessage } from "./messages"
import type { ClientDataFetch, ClientLineChartMessageBody } from "./types"

describe("sendConversationChartMessage", () => {
  it("sends one chart body through the existing message endpoint", async () => {
    const chart: ClientLineChartMessageBody = {
      chartType: "line",
      data: {
        labels: ["周一", "周二"],
        series: [{ name: "数量", values: [12, 18] }],
      },
      description: "单位：个，按自然日统计",
      title: "项目趋势",
      type: "chart",
    }
    const fetcher = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        body: {
          chart_type: string
          data: ClientLineChartMessageBody["data"]
          description: string
          title: string
          type: "chart"
        }
        client_message_id: string
      }
      expect(request.client_message_id).toBe("client-chart-1")
      expect(request.body).toEqual({
        chart_type: "line",
        data: chart.data,
        description: chart.description,
        title: chart.title,
        type: "chart",
      })

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            message: {
              body: {
                chart_type: "line",
                data: chart.data,
                description: chart.description,
                title: chart.title,
                type: "chart",
              },
              client_message_id: "client-chart-1",
              conversation_id: "conversation-1",
              created_at: "2026-07-14T09:00:00Z",
              id: "message-1",
              sender: { id: "user-1", type: "user" },
              seq: 1,
            },
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 }
      )
    }) as ClientDataFetch

    const message = await sendConversationChartMessage(
      "conversation-1",
      { chart, clientMessageId: "client-chart-1" },
      fetcher
    )

    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation-1/messages",
      expect.objectContaining({ method: "POST" })
    )
    expect(message.body).toEqual(chart)
  })
})
