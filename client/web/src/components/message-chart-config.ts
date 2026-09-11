import type { ClientBarChartMessageBody } from "@/lib/client-data-api"
import type { ChartConfig } from "@/components/ui/chart"

const chartColors = [
  {
    dark: "var(--color-sky-300, #7dd3fc)",
    light: "var(--color-sky-700, #0369a1)",
  },
  {
    dark: "var(--color-sky-400, #38bdf8)",
    light: "var(--color-sky-600, #0284c7)",
  },
  {
    dark: "var(--color-sky-500, #0ea5e9)",
    light: "var(--color-sky-500, #0ea5e9)",
  },
  {
    dark: "var(--color-sky-600, #0284c7)",
    light: "var(--color-sky-400, #38bdf8)",
  },
  {
    dark: "var(--color-sky-700, #0369a1)",
    light: "var(--color-sky-300, #7dd3fc)",
  },
] as const

function getBarChartLayout(
  direction: ClientBarChartMessageBody["data"]["direction"]
): "horizontal" | "vertical" {
  // Recharts names layout by axis orientation, which is the inverse of the
  // human-facing direction in the message protocol.
  return direction === "horizontal" ? "vertical" : "horizontal"
}

function getBarStackID(
  mode: ClientBarChartMessageBody["data"]["mode"]
): "total" | undefined {
  return mode === "stacked" ? "total" : undefined
}

function getBarRadius(
  direction: ClientBarChartMessageBody["data"]["direction"],
  mode: ClientBarChartMessageBody["data"]["mode"],
  seriesIndex: number,
  visibleSeriesIndexes: readonly number[]
): number | [number, number, number, number] {
  if (mode === "grouped") {
    return 4
  }

  const firstIndex = visibleSeriesIndexes[0]
  const lastIndex = visibleSeriesIndexes.at(-1)
  if (seriesIndex !== firstIndex && seriesIndex !== lastIndex) {
    return 0
  }
  if (firstIndex === lastIndex) {
    return 4
  }

  if (direction === "horizontal") {
    return seriesIndex === firstIndex ? [4, 0, 0, 4] : [0, 4, 4, 0]
  }
  return seriesIndex === firstIndex ? [0, 0, 4, 4] : [4, 4, 0, 0]
}

function createChartSeriesConfig(
  series: ReadonlyArray<{ name: string }>
): ChartConfig {
  return Object.fromEntries(
    series.map((item, index) => [
      `series${index + 1}`,
      { label: item.name, theme: chartColors[index] },
    ])
  )
}

function shouldShowChartLegend(seriesCount: number) {
  return seriesCount > 1
}

export {
  chartColors,
  getBarRadius,
  createChartSeriesConfig,
  getBarChartLayout,
  getBarStackID,
  shouldShowChartLegend,
}
