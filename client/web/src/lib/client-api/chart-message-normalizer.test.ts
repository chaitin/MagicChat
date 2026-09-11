import { describe, expect, it } from "vitest"

import { normalizeMessage } from "./message-normalizers"
import type { MessageBodyResponse, MessageResponse } from "./types"

describe("chart message normalization", () => {
  it.each([
    {
      body: {
        chart_type: "line",
        data: {
          labels: [" 周一 ", "周二"],
          series: [{ name: " 发送 ", values: [12, null] }],
        },
        description: " 单位：条，按自然日统计 ",
        title: " 项目趋势 ",
        type: "chart",
      },
      chartType: "line",
    },
    {
      body: {
        chart_type: "bar",
        data: {
          direction: "horizontal",
          labels: ["一月"],
          mode: "stacked",
          series: [{ name: "新增", values: [12] }],
        },
        description: "单位：个",
        title: "任务对比",
        type: "chart",
      },
      chartType: "bar",
    },
    {
      body: {
        chart_type: "pie",
        data: {
          items: [
            { name: "待办", value: 12 },
            { name: "完成", value: 8 },
          ],
        },
        description: "共 20 个任务",
        title: "任务分布",
        type: "chart",
      },
      chartType: "pie",
    },
    {
      body: {
        chart_type: "radar",
        data: {
          axes: [
            { max: 100, name: "进度" },
            { max: 100, name: "质量" },
            { max: 100, name: "协作" },
          ],
          series: [{ name: "本周", values: [80, 92, 76] }],
        },
        description: "满分 100 分",
        title: "项目健康度",
        type: "chart",
      },
      chartType: "radar",
    },
  ])("normalizes $chartType charts", ({ body, chartType }) => {
    const normalized = normalizeBody(body as MessageBodyResponse)

    expect(normalized.type).toBe("chart")
    if (normalized.type !== "chart") {
      throw new Error("expected chart message")
    }
    expect(normalized.chartType).toBe(chartType)
    expect(normalized.title).not.toMatch(/^\s|\s$/)
    expect(normalized.description).not.toMatch(/^\s|\s$/)
  })

  it.each([
    {
      chart_type: "line",
      data: {
        labels: ["周一"],
        series: [{ name: "数量", values: [1] }],
      },
      description: "说明",
      title: "趋势",
      type: "chart",
    },
    {
      chart_type: "line",
      data: {
        labels: ["周一", "周二"],
        series: [{ name: "数量", values: [2e15, 2] }],
      },
      description: "说明",
      title: "趋势",
      type: "chart",
    },
    {
      chart_type: "bar",
      data: {
        direction: "diagonal",
        labels: ["一月"],
        mode: "grouped",
        series: [{ name: "数量", values: [1] }],
      },
      description: "说明",
      title: "对比",
      type: "chart",
    },
    {
      chart_type: "pie",
      data: {
        items: [
          { name: "待办", value: 1 },
          { name: "完成", value: 0 },
        ],
      },
      description: "说明",
      title: "分布",
      type: "chart",
    },
    {
      chart_type: "radar",
      data: {
        axes: [
          { max: 100, name: "进度" },
          { max: 100, name: "质量" },
          { max: 100, name: "协作" },
        ],
        series: [{ name: "本周", values: [101, 92, 76] }],
      },
      description: "说明",
      title: "健康度",
      type: "chart",
    },
    {
      chart_type: "line",
      color: "red",
      data: {
        labels: ["周一", "周二"],
        series: [{ name: "数量", values: [1, 2] }],
      },
      description: "说明",
      title: "趋势",
      type: "chart",
    },
  ])("downgrades invalid chart data without rejecting the message", (body) => {
    expect(normalizeBody(body as unknown as MessageBodyResponse)).toEqual({
      type: "unsupported",
    })
  })

  it("keeps a valid chart forwardable inside merged chat history", () => {
    const normalized = normalizeBody({
      item_count: 1,
      items: [
        {
          body: {
            chart_type: "pie",
            data: {
              items: [
                { name: "待办", value: 12 },
                { name: "完成", value: 8 },
              ],
            },
            description: "共 20 个任务",
            title: "任务分布",
            type: "chart",
          },
          sender_name: "Alice",
          sender_type: "user",
          sent_at: "2026-07-14T09:00:00Z",
          summary: "[图表] 任务分布",
        },
      ],
      type: "forward_bundle",
    })

    expect(normalized.type).toBe("forward_bundle")
    if (normalized.type === "forward_bundle") {
      expect(normalized.items[0].body.type).toBe("chart")
    }
  })
})

function normalizeBody(body: MessageBodyResponse) {
  const response: MessageResponse = {
    body,
    conversation_id: "conversation-1",
    created_at: "2026-07-14T09:00:00Z",
    id: "message-1",
    sender: { id: "user-1", type: "user" },
    seq: 1,
  }
  return normalizeMessage(response).body
}
