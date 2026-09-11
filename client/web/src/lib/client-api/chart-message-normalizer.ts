import { ClientDataRequestError } from "./core"
import type {
  ChartMessageBodyResponse,
  ClientChartMessageBody,
  ClientChartSeries,
} from "./types"

const maxChartTitleLength = 16
const maxChartDescriptionLength = 128
const maxChartLabelLength = 64
const maxChartLabels = 100
const maxChartSeries = 5
const maxChartValue = 1_000_000_000_000_000

export function normalizeChartMessageBody(
  body: ChartMessageBodyResponse
): ClientChartMessageBody {
  if (
    !hasOnlyKeys(body, [
      "type",
      "chart_type",
      "title",
      "data",
      "description",
    ]) ||
    typeof body.title !== "string" ||
    typeof body.description !== "string"
  ) {
    throw invalidChartMessage()
  }

  const title = normalizeChartText(body.title, maxChartTitleLength, "图表标题")
  const description = normalizeChartText(
    body.description,
    maxChartDescriptionLength,
    "图表描述"
  )

  if (body.chart_type === "line") {
    const data = normalizeCartesianData(body.data, 2)
    return {
      chartType: "line",
      data,
      description,
      title,
      type: "chart",
    }
  }

  if (body.chart_type === "bar") {
    if (
      !isRecord(body.data) ||
      !hasOnlyKeys(body.data, ["direction", "mode", "labels", "series"]) ||
      (body.data.direction !== "horizontal" &&
        body.data.direction !== "vertical") ||
      (body.data.mode !== "grouped" && body.data.mode !== "stacked")
    ) {
      throw invalidChartMessage()
    }
    const cartesian = normalizeCartesianData(
      { labels: body.data.labels, series: body.data.series },
      1
    )
    if (body.data.mode === "stacked") {
      validateStackedTotals(cartesian.series, cartesian.labels.length)
    }
    return {
      chartType: "bar",
      data: {
        direction: body.data.direction,
        labels: cartesian.labels,
        mode: body.data.mode,
        series: cartesian.series,
      },
      description,
      title,
      type: "chart",
    }
  }

  if (body.chart_type === "pie") {
    if (
      !isRecord(body.data) ||
      !hasOnlyKeys(body.data, ["items"]) ||
      !Array.isArray(body.data.items) ||
      body.data.items.length < 2 ||
      body.data.items.length > 5
    ) {
      throw invalidChartMessage()
    }
    const names = new Set<string>()
    const items = body.data.items.map((rawItem) => {
      if (
        !isRecord(rawItem) ||
        !hasOnlyKeys(rawItem, ["name", "value"]) ||
        typeof rawItem.name !== "string" ||
        !isPositiveChartNumber(rawItem.value)
      ) {
        throw invalidChartMessage()
      }
      const name = normalizeChartText(
        rawItem.name,
        maxChartLabelLength,
        "饼图项目名称"
      )
      requireUniqueChartName(names, name)
      return { name, value: rawItem.value }
    })
    if (!Number.isFinite(items.reduce((sum, item) => sum + item.value, 0))) {
      throw invalidChartMessage()
    }
    return {
      chartType: "pie",
      data: { items },
      description,
      title,
      type: "chart",
    }
  }

  if (body.chart_type === "radar") {
    if (
      !isRecord(body.data) ||
      !hasOnlyKeys(body.data, ["axes", "series"]) ||
      !Array.isArray(body.data.axes) ||
      body.data.axes.length < 3 ||
      body.data.axes.length > 12
    ) {
      throw invalidChartMessage()
    }
    const axisNames = new Set<string>()
    const axes = body.data.axes.map((rawAxis) => {
      if (
        !isRecord(rawAxis) ||
        !hasOnlyKeys(rawAxis, ["name", "max"]) ||
        typeof rawAxis.name !== "string" ||
        !isPositiveChartNumber(rawAxis.max)
      ) {
        throw invalidChartMessage()
      }
      const name = normalizeChartText(
        rawAxis.name,
        maxChartLabelLength,
        "雷达图维度名称"
      )
      requireUniqueChartName(axisNames, name)
      return { max: rawAxis.max, name }
    })
    const series = normalizeSeries(body.data.series, axes.length, false).map(
      (item) => ({
        name: item.name,
        values: item.values.map((value, index) => {
          if (value === null || value < 0 || value > axes[index].max) {
            throw invalidChartMessage()
          }
          return value
        }),
      })
    )
    return {
      chartType: "radar",
      data: { axes, series },
      description,
      title,
      type: "chart",
    }
  }

  throw invalidChartMessage()
}

function normalizeCartesianData(
  rawData: unknown,
  minLabels: number
): { labels: string[]; series: ClientChartSeries[] } {
  if (
    !isRecord(rawData) ||
    !hasOnlyKeys(rawData, ["labels", "series"]) ||
    !Array.isArray(rawData.labels) ||
    rawData.labels.length < minLabels ||
    rawData.labels.length > maxChartLabels
  ) {
    throw invalidChartMessage()
  }
  const labels = rawData.labels.map((label) => {
    if (typeof label !== "string") {
      throw invalidChartMessage()
    }
    return normalizeChartText(label, maxChartLabelLength, "图表标签")
  })
  return {
    labels,
    series: normalizeSeries(rawData.series, labels.length, true),
  }
}

function normalizeSeries(
  rawSeries: unknown,
  valueCount: number,
  allowNull: boolean
): ClientChartSeries[] {
  if (
    !Array.isArray(rawSeries) ||
    rawSeries.length < 1 ||
    rawSeries.length > maxChartSeries
  ) {
    throw invalidChartMessage()
  }
  const names = new Set<string>()
  return rawSeries.map((rawItem) => {
    if (
      !isRecord(rawItem) ||
      !hasOnlyKeys(rawItem, ["name", "values"]) ||
      typeof rawItem.name !== "string" ||
      !Array.isArray(rawItem.values) ||
      rawItem.values.length !== valueCount
    ) {
      throw invalidChartMessage()
    }
    const name = normalizeChartText(
      rawItem.name,
      maxChartLabelLength,
      "图表系列名称"
    )
    requireUniqueChartName(names, name)
    let hasNumber = false
    const values = rawItem.values.map((value) => {
      if (value === null && allowNull) {
        return null
      }
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > maxChartValue
      ) {
        throw invalidChartMessage()
      }
      hasNumber = true
      return value
    })
    if (!hasNumber) {
      throw invalidChartMessage()
    }
    return { name, values }
  })
}

function normalizeChartText(value: string, limit: number, field: string) {
  const normalized = value.trim()
  if (!normalized || Array.from(normalized).length > limit) {
    throw new ClientDataRequestError(`${field}格式不正确`)
  }
  return normalized
}

function validateStackedTotals(
  series: ClientChartSeries[],
  valueCount: number
) {
  for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
    let positiveTotal = 0
    let negativeTotal = 0
    for (const current of series) {
      const value = current.values[valueIndex]
      if (value === null) {
        continue
      }
      if (value >= 0) {
        positiveTotal += value
      } else {
        negativeTotal += value
      }
    }
    if (!Number.isFinite(positiveTotal) || !Number.isFinite(negativeTotal)) {
      throw invalidChartMessage()
    }
  }
}

function requireUniqueChartName(names: Set<string>, name: string) {
  if (names.has(name)) {
    throw invalidChartMessage()
  }
  names.add(name)
}

function isPositiveChartNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= maxChartValue
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: object, allowedKeys: string[]) {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function invalidChartMessage() {
  return new ClientDataRequestError("图表消息格式不正确")
}
