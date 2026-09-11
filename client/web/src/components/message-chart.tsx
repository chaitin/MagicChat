import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  chartColors,
  createChartSeriesConfig,
  getBarChartLayout,
  getBarRadius,
  getBarStackID,
  shouldShowChartLegend,
} from "@/components/message-chart-config"
import type {
  ClientBarChartMessageBody,
  ClientChartMessageBody,
  ClientChartSeries,
  ClientLineChartMessageBody,
  ClientPieChartMessageBody,
  ClientRadarChartMessageBody,
} from "@/lib/client-data-api"

const defaultChartHeight = 256
const defaultChartWidth = 480
const radarGridAnchorKey = "radarGridAnchor"

export const MessageChart = React.memo(function MessageChart({
  chart,
}: {
  chart: ClientChartMessageBody
}) {
  return (
    <div
      className="grid w-120 max-w-full gap-3"
      data-chart-type={chart.chartType}
      data-slot="message-chart"
    >
      <div className="border-b border-foreground/10 pb-2 text-sm leading-snug font-medium">
        {chart.title}
      </div>
      <ChartBody chart={chart} />
      <div className="border-t border-foreground/10 pt-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {chart.description}
      </div>
    </div>
  )
})

function ChartBody({ chart }: { chart: ClientChartMessageBody }) {
  switch (chart.chartType) {
    case "line":
      return <LineMessageChart chart={chart} />
    case "bar":
      return <BarMessageChart chart={chart} />
    case "pie":
      return <PieMessageChart chart={chart} />
    case "radar":
      return <RadarMessageChart chart={chart} />
  }
}

function LineMessageChart({ chart }: { chart: ClientLineChartMessageBody }) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const config = createChartSeriesConfig(chart.data.series)
  const data = createCartesianRows(chart.data.labels, chart.data.series)
  const width = getScrollableChartWidth(chart.data.labels.length, 36)

  return (
    <ChartViewport width={width}>
      <ChartContainer
        className="aspect-auto h-64 w-full"
        config={config}
        initialDimension={{ height: defaultChartHeight, width }}
      >
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ left: 4, right: 12 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="label"
            hide
            minTickGap={24}
            tickFormatter={formatAxisLabel}
            tickLine={false}
          />
          <YAxis axisLine={false} tickLine={false} width={40} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {shouldShowChartLegend(chart.data.series.length) && (
            <ChartLegend
              content={
                <ChartLegendContent
                  className="flex-wrap"
                  hiddenKeys={hiddenKeys}
                  onItemToggle={toggleKey}
                />
              }
            />
          )}
          {chart.data.series.map((_, index) => {
            const key = seriesKey(index)
            return (
              <Line
                connectNulls={false}
                dataKey={key}
                dot={chart.data.labels.length <= 20}
                hide={hiddenKeys.has(key)}
                key={key}
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                type="monotone"
              />
            )
          })}
        </LineChart>
      </ChartContainer>
    </ChartViewport>
  )
}

function BarMessageChart({ chart }: { chart: ClientBarChartMessageBody }) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const config = createChartSeriesConfig(chart.data.series)
  const data = createCartesianRows(chart.data.labels, chart.data.series)
  const horizontal = chart.data.direction === "horizontal"
  const height = horizontal
    ? Math.max(defaultChartHeight, chart.data.labels.length * 28)
    : defaultChartHeight
  const width = horizontal
    ? defaultChartWidth
    : getScrollableChartWidth(chart.data.labels.length, 32)
  const visibleSeriesIndexes = chart.data.series.flatMap((_, index) =>
    hiddenKeys.has(seriesKey(index)) ? [] : [index]
  )
  const bars = chart.data.series.map((_, index) => {
    const key = seriesKey(index)
    return (
      <Bar
        dataKey={key}
        fill={`var(--color-${key})`}
        hide={hiddenKeys.has(key)}
        key={key}
        radius={getBarRadius(
          chart.data.direction,
          chart.data.mode,
          index,
          visibleSeriesIndexes
        )}
        stackId={getBarStackID(chart.data.mode)}
      />
    )
  })

  return (
    <ChartViewport height={height} vertical={horizontal} width={width}>
      <ChartContainer
        className="aspect-auto w-full"
        config={config}
        initialDimension={{ height, width }}
        style={{ height }}
      >
        {horizontal ? (
          <BarChart
            accessibilityLayer
            data={data}
            layout={getBarChartLayout(chart.data.direction)}
            margin={{ left: 12, right: 12 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis axisLine={false} hide tickLine={false} type="number" />
            <YAxis
              axisLine={false}
              dataKey="label"
              tickFormatter={formatAxisLabel}
              tickLine={false}
              type="category"
              width={72}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {shouldShowChartLegend(chart.data.series.length) && (
              <ChartLegend
                content={
                  <ChartLegendContent
                    className="flex-wrap"
                    hiddenKeys={hiddenKeys}
                    onItemToggle={toggleKey}
                  />
                }
              />
            )}
            {bars}
          </BarChart>
        ) : (
          <BarChart
            accessibilityLayer
            data={data}
            layout={getBarChartLayout(chart.data.direction)}
            margin={{ left: 4, right: 12 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              hide
              minTickGap={20}
              tickFormatter={formatAxisLabel}
              tickLine={false}
            />
            <YAxis axisLine={false} tickLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {shouldShowChartLegend(chart.data.series.length) && (
              <ChartLegend
                content={
                  <ChartLegendContent
                    className="flex-wrap"
                    hiddenKeys={hiddenKeys}
                    onItemToggle={toggleKey}
                  />
                }
              />
            )}
            {bars}
          </BarChart>
        )}
      </ChartContainer>
    </ChartViewport>
  )
}

function PieMessageChart({ chart }: { chart: ClientPieChartMessageBody }) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const config: ChartConfig = {}
  const data = chart.data.items.map((item, index) => {
    const key = itemKey(index)
    config[key] = { label: item.name, theme: chartColors[index] }
    return {
      fill: `var(--color-${key})`,
      key,
      name: item.name,
      value: hiddenKeys.has(key) ? 0 : item.value,
    }
  })

  return (
    <ChartContainer
      className="aspect-auto h-64 w-full"
      config={config}
      initialDimension={{
        height: defaultChartHeight,
        width: defaultChartWidth,
      }}
    >
      <PieChart accessibilityLayer>
        <ChartTooltip
          content={<ChartTooltipContent hideLabel nameKey="key" />}
        />
        <ChartLegend
          content={
            <ChartLegendContent
              className="flex-wrap"
              hiddenKeys={hiddenKeys}
              nameKey="key"
              onItemToggle={toggleKey}
            />
          }
        />
        <Pie data={data} dataKey="value" nameKey="name" outerRadius="75%" />
      </PieChart>
    </ChartContainer>
  )
}

function RadarMessageChart({ chart }: { chart: ClientRadarChartMessageBody }) {
  const { hiddenKeys, toggleKey } = useHiddenChartItems()
  const allSeriesHidden = chart.data.series.every((_, index) =>
    hiddenKeys.has(seriesKey(index))
  )
  const config = createChartSeriesConfig(chart.data.series)
  const data = chart.data.axes.map((axis, axisIndex) => {
    const row: Record<string, number | string> = {
      axis: axis.name,
      [radarGridAnchorKey]: 100,
    }
    chart.data.series.forEach((series, seriesIndex) => {
      const key = seriesKey(seriesIndex)
      const rawValue = series.values[axisIndex]
      row[key] = (rawValue / axis.max) * 100
      row[`${key}Raw`] = rawValue
    })
    return row
  })

  return (
    <ChartContainer
      className="aspect-auto h-64 w-full"
      config={config}
      initialDimension={{
        height: defaultChartHeight,
        width: defaultChartWidth,
      }}
    >
      <RadarChart accessibilityLayer data={data} outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tickFormatter={formatAxisLabel} />
        <PolarRadiusAxis axisLine={false} domain={[0, 100]} tick={false} />
        <ChartTooltip
          content={<RadarTooltipContent series={chart.data.series} />}
        />
        {shouldShowChartLegend(chart.data.series.length) && (
          <ChartLegend
            content={
              <ChartLegendContent
                className="flex-wrap"
                hiddenKeys={hiddenKeys}
                onItemToggle={toggleKey}
              />
            }
          />
        )}
        {allSeriesHidden && (
          <Radar
            activeDot={false}
            className="message-chart-radar-grid-anchor"
            dataKey={radarGridAnchorKey}
            dot={false}
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            stroke="transparent"
            tooltipType="none"
          />
        )}
        {chart.data.series.map((_, index) => {
          const key = seriesKey(index)
          return (
            <Radar
              dataKey={key}
              fill={`var(--color-${key})`}
              fillOpacity={0.3}
              hide={hiddenKeys.has(key)}
              key={key}
              stroke={`var(--color-${key})`}
              strokeWidth={2}
            />
          )
        })}
      </RadarChart>
    </ChartContainer>
  )
}

function RadarTooltipContent({
  series,
}: {
  series: ClientRadarChartMessageBody["data"]["series"]
}) {
  return (
    <ChartTooltipContent
      formatter={(_value, _name, item) => {
        const dataKey = String(item.dataKey ?? "")
        const rawValue = item.payload?.[`${dataKey}Raw`]
        const seriesIndex =
          Number.parseInt(dataKey.replace("series", ""), 10) - 1
        const seriesName = series[seriesIndex]?.name ?? dataKey
        return (
          <div className="flex w-full items-center justify-between gap-4">
            <span className="text-muted-foreground">{seriesName}</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {typeof rawValue === "number"
                ? rawValue.toLocaleString()
                : String(rawValue ?? "")}
            </span>
          </div>
        )
      }}
    />
  )
}

function ChartViewport({
  children,
  height = defaultChartHeight,
  vertical = false,
  width,
}: {
  children: React.ReactNode
  height?: number
  vertical?: boolean
  width: number
}) {
  return (
    <div
      className={
        vertical ? "max-h-96 overflow-y-auto" : "max-w-full overflow-x-auto"
      }
    >
      <div style={{ height, width }}>{children}</div>
    </div>
  )
}

function createCartesianRows(labels: string[], series: ClientChartSeries[]) {
  return labels.map((label, labelIndex) => {
    const row: Record<string, number | string | null> = { label }
    series.forEach((item, seriesIndex) => {
      row[seriesKey(seriesIndex)] = item.values[labelIndex]
    })
    return row
  })
}

function getScrollableChartWidth(itemCount: number, pixelsPerItem: number) {
  return Math.max(defaultChartWidth, itemCount * pixelsPerItem)
}

function formatAxisLabel(value: unknown) {
  const label = String(value ?? "")
  return Array.from(label).length > 8
    ? `${Array.from(label).slice(0, 8).join("")}…`
    : label
}

function seriesKey(index: number) {
  return `series${index + 1}`
}

function itemKey(index: number) {
  return `item${index + 1}`
}

function useHiddenChartItems() {
  const [hiddenKeys, setHiddenKeys] = React.useState<Set<string>>(
    () => new Set()
  )
  const toggleKey = React.useCallback((key: string) => {
    setHiddenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return { hiddenKeys, toggleKey }
}
