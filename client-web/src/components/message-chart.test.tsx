import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { MessageChart } from "@/components/message-chart"
import {
  chartColors,
  createChartSeriesConfig,
  getBarChartLayout,
  getBarStackID,
  shouldShowChartLegend,
} from "@/components/message-chart-config"
import type { ClientChartMessageBody } from "@/lib/client-data-api"

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 448, 256)
  )
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe("MessageChart", () => {
  it("maps protocol bar direction and mode to Recharts semantics", () => {
    expect(getBarChartLayout("horizontal")).toBe("vertical")
    expect(getBarChartLayout("vertical")).toBe("horizontal")
    expect(getBarStackID("grouped")).toBeUndefined()
    expect(getBarStackID("stacked")).toBe("total")
  })

  it("builds legend entries for every series in a multi-series chart", () => {
    const config = createChartSeriesConfig([{ name: "发送" }, { name: "接收" }])

    expect(shouldShowChartLegend(1)).toBe(false)
    expect(shouldShowChartLegend(2)).toBe(true)
    expect(config.series1.label).toBe("发送")
    expect(config.series2.label).toBe("接收")
    expect(config.series1.theme).toEqual(chartColors[0])
    expect(config.series2.theme).toEqual(chartColors[1])
  })

  it.each(["line", "bar", "radar"] as const)(
    "toggles a %s series by clicking its legend item",
    async (chartType) => {
      const user = userEvent.setup()
      const chart = createCharts().find((item) => item.chartType === chartType)
      if (!chart) {
        throw new Error(`Missing ${chartType} chart fixture`)
      }

      render(<MessageChart chart={chart} />)

      const firstLegendItem = screen.getByRole("button", {
        name: chartType === "radar" ? "本周" : chartType === "bar" ? "新增" : "发送",
      })
      expect(firstLegendItem).toHaveAttribute("aria-pressed", "true")
      expect(firstLegendItem).toHaveAttribute("data-state", "on")

      await user.click(firstLegendItem)
      expect(firstLegendItem).toHaveAttribute("aria-pressed", "false")
      expect(firstLegendItem).toHaveAttribute("data-state", "off")

      await user.click(firstLegendItem)
      expect(firstLegendItem).toHaveAttribute("aria-pressed", "true")
      expect(firstLegendItem).toHaveAttribute("data-state", "on")
    }
  )

  it("keeps a disabled pie item in the legend so it can be enabled again", async () => {
    const user = userEvent.setup()
    const chart = createCharts().find((item) => item.chartType === "pie")
    if (!chart) {
      throw new Error("Missing pie chart fixture")
    }

    render(<MessageChart chart={chart} />)

    const legendItem = screen.getByRole("button", { name: "待办" })
    await user.click(legendItem)
    expect(legendItem).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "待办" })).toBeInTheDocument()

    await user.click(legendItem)
    expect(legendItem).toHaveAttribute("aria-pressed", "true")
  })
})

function createCharts(): ClientChartMessageBody[] {
  return [
    {
      chartType: "line",
      data: {
        labels: ["周一", "周二"],
        series: [
          { name: "发送", values: [12, 18] },
          { name: "接收", values: [10, 16] },
        ],
      },
      description: "单位：条，按自然日统计",
      title: "消息趋势",
      type: "chart",
    },
    {
      chartType: "bar",
      data: {
        direction: "horizontal",
        labels: ["一月", "二月"],
        mode: "stacked",
        series: [
          { name: "新增", values: [12, 18] },
          { name: "完成", values: [8, 15] },
        ],
      },
      description: "单位：个，按月份统计",
      title: "任务对比",
      type: "chart",
    },
    {
      chartType: "pie",
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
    {
      chartType: "radar",
      data: {
        axes: [
          { max: 100, name: "进度" },
          { max: 100, name: "质量" },
          { max: 100, name: "协作" },
        ],
        series: [
          { name: "本周", values: [80, 92, 76] },
          { name: "上周", values: [70, 86, 72] },
        ],
      },
      description: "满分 100 分",
      title: "项目健康度",
      type: "chart",
    },
  ]
}
