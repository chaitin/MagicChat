import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DesktopMessageBody } from "../../../../shared/account-data"
import { cn } from "@/lib/utils"
import { record } from "./utils"

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]
type ChartBodyValue = Extract<DesktopMessageBody, { type: "chart" }>
type LegendItem = { key: string; label: string; color: string }
type SeriesItem = { key: string; name: string; values: unknown[]; color: string }
const tooltipStyle = { fontSize: 12 }

export function ChartBody({ body }: { body: ChartBodyValue }) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set())
  const model = useMemo(() => createChartModel(body, hiddenKeys), [body, hiddenKeys])

  useEffect(() => setHiddenKeys(new Set()), [body])

  function toggleLegend(key: string) {
    setHiddenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="grid w-[30rem] max-w-full gap-3" data-chart-type={body.chartType}>
      <div className="border-b border-foreground/10 pb-2 text-sm leading-snug font-medium">
        {body.title}
      </div>
      <div className="h-64 w-full">
        {model ? (
          <ResponsiveContainer>{model.chart}</ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            暂不支持查看该图表
          </div>
        )}
      </div>
      {model && model.legend.length > 0 && (
        <ChartLegend items={model.legend} hiddenKeys={hiddenKeys} onToggle={toggleLegend} />
      )}
      <div className="border-t border-foreground/10 pt-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {body.description}
      </div>
    </div>
  )
}

function createChartModel(body: ChartBodyValue, hiddenKeys: Set<string>) {
  const data = record(body.data)
  if (!data) return null
  if (
    (body.chartType === "line" || body.chartType === "bar") &&
    Array.isArray(data.labels) &&
    Array.isArray(data.series)
  ) {
    const series = parseSeries(data.series)
    const rows = data.labels.map((label, index) =>
      Object.fromEntries([
        ["label", String(label)],
        ...series.map((item) => [item.key, item.values[index] ?? null]),
      ]),
    )
    const legend = series.map(({ key, name, color }) => ({ key, label: name, color }))
    if (body.chartType === "line") {
      return {
        legend,
        chart: (
          <LineChart data={rows} margin={{ left: 4, right: 12 }}>
            <CartesianGrid stroke="var(--xgui-background-0)" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            />
            <YAxis hide />
            <Tooltip contentStyle={tooltipStyle} />
            {series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.name}
                hide={hiddenKeys.has(item.key)}
                stroke={item.color}
                strokeWidth={2}
                type="monotone"
              />
            ))}
          </LineChart>
        ),
      }
    }
    const horizontal = data.direction === "horizontal"
    const stacked = data.mode === "stacked"
    const bars = series.map((item) => (
      <Bar
        key={item.key}
        dataKey={item.key}
        name={item.name}
        hide={hiddenKeys.has(item.key)}
        fill={item.color}
        radius={4}
        stackId={stacked ? "total" : undefined}
      />
    ))
    return {
      legend,
      chart: horizontal ? (
        <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 12 }}>
          <CartesianGrid stroke="var(--xgui-background-0)" horizontal={false} />
          <XAxis
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <YAxis type="category" dataKey="label" hide />
          <Tooltip contentStyle={tooltipStyle} />
          {bars}
        </BarChart>
      ) : (
        <BarChart data={rows} margin={{ left: 4, right: 12 }}>
          <CartesianGrid stroke="var(--xgui-background-0)" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <YAxis hide />
          <Tooltip contentStyle={tooltipStyle} />
          {bars}
        </BarChart>
      ),
    }
  }
  if (body.chartType === "pie" && Array.isArray(data.items)) {
    const items = data.items.flatMap((value, index) => {
      const item = record(value)
      return item && typeof item.name === "string" && typeof item.value === "number"
        ? [
            {
              key: `item${index + 1}`,
              name: item.name,
              value: item.value,
              color: chartColors[index % chartColors.length],
            },
          ]
        : []
    })
    return {
      legend: items.map(({ key, name, color }) => ({ key, label: name, color })),
      chart: (
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie
            data={items.map((item) => ({
              ...item,
              value: hiddenKeys.has(item.key) ? 0 : item.value,
            }))}
            dataKey="value"
            nameKey="name"
            outerRadius="75%"
          >
            {items.map((item) => (
              <Cell key={item.key} fill={item.color} />
            ))}
          </Pie>
        </PieChart>
      ),
    }
  }
  if (body.chartType === "radar" && Array.isArray(data.axes) && Array.isArray(data.series)) {
    const axes = data.axes.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" ? [{ name: item.name }] : []
    })
    const series = parseSeries(data.series)
    const rows = axes.map((axis, index) =>
      Object.fromEntries([
        ["label", axis.name],
        ...series.map((item) => [item.key, item.values[index] ?? 0]),
      ]),
    )
    return {
      legend: series.map(({ key, name, color }) => ({ key, label: name, color })),
      chart: (
        <RadarChart data={rows} outerRadius="70%">
          <PolarGrid stroke="var(--xgui-background-0)" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <PolarRadiusAxis axisLine={false} tick={false} />
          <Tooltip contentStyle={tooltipStyle} />
          {series.map((item) => (
            <Radar
              key={item.key}
              dataKey={item.key}
              name={item.name}
              hide={hiddenKeys.has(item.key)}
              stroke={item.color}
              fill={item.color}
              fillOpacity={0.18}
              strokeWidth={2}
            />
          ))}
        </RadarChart>
      ),
    }
  }
  return null
}

function parseSeries(values: unknown[]): SeriesItem[] {
  return values.flatMap((value, index) => {
    const item = record(value)
    return item && typeof item.name === "string" && Array.isArray(item.values)
      ? [
          {
            key: `series${index + 1}`,
            name: item.name,
            values: item.values,
            color: chartColors[index % chartColors.length],
          },
        ]
      : []
  })
}

function ChartLegend({
  items,
  hiddenKeys,
  onToggle,
}: {
  items: LegendItem[]
  hiddenKeys: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
      {items.map((item) => {
        const hidden = hiddenKeys.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground transition-opacity hover:text-foreground",
              hidden && "opacity-40",
            )}
            aria-pressed={!hidden}
            onClick={() => onToggle(item.key)}
          >
            <span className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
