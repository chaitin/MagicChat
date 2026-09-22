import { AuthFailure, isRecord } from "../../shared/auth.ts"

const maximumChartValue = 1_000_000_000_000_000

export function normalizeOutgoingRichMessageBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidRichMessage()
  if (value.type === "choice") return normalizeChoice(value)
  if (value.type === "chart") return normalizeChart(value)
  throw invalidRichMessage()
}

function normalizeChoice(value: Record<string, unknown>) {
  const content = requiredText(
    value.content,
    5_000,
    "选择内容不能为空",
    "选择内容不能超过 5000 个字符",
  )
  if (value.contentType !== "text" && value.contentType !== "markdown") {
    throw new AuthFailure("invalid_rich_message", "选择内容格式不正确")
  }
  if (value.selection !== "single" && value.selection !== "multiple") {
    throw new AuthFailure("invalid_rich_message", "选择模式不正确")
  }
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 20) {
    throw new AuthFailure("invalid_rich_message", "选择项数量必须在 2 到 20 之间")
  }
  const seen = new Set<string>()
  const options = value.options.map((item) => {
    if (!isRecord(item)) throw invalidRichMessage()
    const id = typeof item.id === "string" ? item.id.trim() : ""
    const label = requiredText(
      item.label,
      200,
      "选择项内容不能为空",
      "选择项内容不能超过 200 个字符",
    )
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(id) || /[\p{Cc}\u2028\u2029]/u.test(label)) {
      throw new AuthFailure("invalid_rich_message", "选择项格式不正确")
    }
    seen.add(id)
    return { id, label }
  })
  return {
    type: "choice",
    content,
    content_type: value.contentType,
    selection: value.selection,
    options,
  }
}

function normalizeChart(value: Record<string, unknown>) {
  const title = requiredText(value.title, 16, "图表标题不能为空", "图表标题不能超过 16 个字符")
  const description = requiredText(
    value.description,
    128,
    "图表说明不能为空",
    "图表说明不能超过 128 个字符",
  )
  const data = isRecord(value.data) ? value.data : null
  if (!data) throw invalidRichMessage()

  let normalizedData: Record<string, unknown>
  switch (value.chartType) {
    case "line":
      normalizedData = normalizeCartesian(data)
      break
    case "bar": {
      const direction = data.direction
      const mode = data.mode
      if (direction !== "horizontal" && direction !== "vertical") throw invalidRichMessage()
      if (mode !== "grouped" && mode !== "stacked") throw invalidRichMessage()
      normalizedData = { ...normalizeCartesian(data, 1), direction, mode }
      break
    }
    case "pie":
      normalizedData = normalizePie(data)
      break
    case "radar":
      normalizedData = normalizeRadar(data)
      break
    default:
      throw new AuthFailure("invalid_rich_message", "图表类型不正确")
  }

  return {
    type: "chart",
    chart_type: value.chartType,
    title,
    description,
    data: normalizedData,
  }
}

function normalizeCartesian(data: Record<string, unknown>, minimum = 2) {
  const labels = textList(data.labels, minimum, 100, 64, "图表标签不正确")
  return { labels, series: normalizeSeries(data.series, labels.length) }
}

function normalizePie(data: Record<string, unknown>) {
  if (!Array.isArray(data.items) || data.items.length < 2 || data.items.length > 5) {
    throw new AuthFailure("invalid_rich_message", "饼图项目数量必须在 2 到 5 之间")
  }
  return {
    items: data.items.map((item) => {
      if (!isRecord(item)) throw invalidRichMessage()
      return {
        name: requiredText(item.name, 64, "图表项目名称不能为空", "图表项目名称过长"),
        value: positiveChartNumber(item.value),
      }
    }),
  }
}

function normalizeRadar(data: Record<string, unknown>) {
  if (!Array.isArray(data.axes) || data.axes.length < 3 || data.axes.length > 12) {
    throw new AuthFailure("invalid_rich_message", "雷达图维度数量必须在 3 到 12 之间")
  }
  const axes = data.axes.map((axis) => {
    if (!isRecord(axis)) throw invalidRichMessage()
    const maximum = chartNumber(axis.max)
    if (maximum <= 0) throw invalidRichMessage()
    return {
      name: requiredText(axis.name, 64, "雷达图维度名称不能为空", "雷达图维度名称过长"),
      max: maximum,
    }
  })
  const series = normalizeSeries(data.series, axes.length, false)
  for (const item of series) {
    for (let index = 0; index < axes.length; index++) {
      const number = item.values[index]
      if (number === null || number < 0 || number > axes[index].max) {
        throw new AuthFailure("invalid_rich_message", "雷达图数值必须在 0 和对应维度最大值之间")
      }
    }
  }
  return { axes, series }
}

function normalizeSeries(value: unknown, valueCount: number, allowNull = true) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new AuthFailure("invalid_rich_message", "图表系列数量必须在 1 到 5 之间")
  }
  return value.map((series) => {
    if (!isRecord(series) || !Array.isArray(series.values) || series.values.length !== valueCount) {
      throw new AuthFailure("invalid_rich_message", "图表系列数据数量与标签不一致")
    }
    return {
      name: requiredText(series.name, 64, "图表系列名称不能为空", "图表系列名称过长"),
      values: series.values.map((value) =>
        allowNull && value === null ? null : chartNumber(value),
      ),
    }
  })
}

function textList(
  value: unknown,
  minimum: number,
  maximum: number,
  maximumLength: number,
  message: string,
) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new AuthFailure("invalid_rich_message", message)
  }
  return value.map((item) => requiredText(item, maximumLength, message, message))
}

function positiveChartNumber(value: unknown) {
  const number = chartNumber(value)
  if (number <= 0) throw new AuthFailure("invalid_rich_message", "图表数值必须大于 0")
  return number
}

function chartNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximumChartValue) {
    throw new AuthFailure("invalid_rich_message", "图表数值不正确")
  }
  return value
}

function requiredText(value: unknown, maximum: number, emptyMessage: string, longMessage: string) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) throw new AuthFailure("invalid_rich_message", emptyMessage)
  if (Array.from(text).length > maximum) {
    throw new AuthFailure("invalid_rich_message", longMessage)
  }
  return text
}

function invalidRichMessage() {
  return new AuthFailure("invalid_rich_message", "富消息参数不正确")
}
