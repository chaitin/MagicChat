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
import { record } from "./utils"

const chartColors = ["#07c160", "#576b95", "#fa9d3b", "#fa5151", "#10aeff"]

export function ChartBody({ body }: { body: Extract<DesktopMessageBody, { type: "chart" }> }) {
  const data = renderChart(body)
  return (
    <div className="grid h-72 w-[30rem] max-w-full grid-rows-[auto_1fr] gap-3">
      <div>
        <div className="font-medium">{body.title}</div>
        {body.description && (
          <div className="text-xs text-muted-foreground">{body.description}</div>
        )}
      </div>
      {data ? (
        <ResponsiveContainer>{data}</ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center text-muted-foreground">
          暂不支持查看该图表
        </div>
      )}
    </div>
  )
}

function renderChart(body: Extract<DesktopMessageBody, { type: "chart" }>) {
  const data = record(body.data)
  if (!data) return null
  if (
    (body.chartType === "line" || body.chartType === "bar") &&
    Array.isArray(data.labels) &&
    Array.isArray(data.series)
  ) {
    const series = data.series.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && Array.isArray(item.values)
        ? [{ name: item.name, values: item.values }]
        : []
    })
    const rows = data.labels.map((label, index) =>
      Object.fromEntries([
        ["name", String(label)],
        ...series.map((item) => [item.name, item.values[index] ?? null]),
      ]),
    )
    if (body.chartType === "line") {
      return (
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          {series.map((item, index) => (
            <Line
              key={item.name}
              dataKey={item.name}
              stroke={chartColors[index % chartColors.length]}
            />
          ))}
        </LineChart>
      )
    }
    return (
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        {series.map((item, index) => (
          <Bar key={item.name} dataKey={item.name} fill={chartColors[index % chartColors.length]} />
        ))}
      </BarChart>
    )
  }
  if (body.chartType === "pie" && Array.isArray(data.items)) {
    const items = data.items.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && typeof item.value === "number"
        ? [{ name: item.name, value: item.value }]
        : []
    })
    return (
      <PieChart>
        <Tooltip />
        <Pie data={items} dataKey="value" nameKey="name" outerRadius="80%">
          {items.map((_, index) => (
            <Cell key={index} fill={chartColors[index % chartColors.length]} />
          ))}
        </Pie>
      </PieChart>
    )
  }
  if (body.chartType === "radar" && Array.isArray(data.axes) && Array.isArray(data.series)) {
    const axes = data.axes.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" ? [{ name: item.name }] : []
    })
    const series = data.series.flatMap((value) => {
      const item = record(value)
      return item && typeof item.name === "string" && Array.isArray(item.values)
        ? [{ name: item.name, values: item.values }]
        : []
    })
    const rows = axes.map((axis, index) =>
      Object.fromEntries([
        ["name", axis.name],
        ...series.map((item) => [item.name, item.values[index] ?? 0]),
      ]),
    )
    return (
      <RadarChart data={rows}>
        <PolarGrid />
        <PolarAngleAxis dataKey="name" />
        <PolarRadiusAxis />
        {series.map((item, index) => (
          <Radar
            key={item.name}
            dataKey={item.name}
            stroke={chartColors[index % chartColors.length]}
            fill={chartColors[index % chartColors.length]}
            fillOpacity={0.18}
          />
        ))}
      </RadarChart>
    )
  }
  return null
}
