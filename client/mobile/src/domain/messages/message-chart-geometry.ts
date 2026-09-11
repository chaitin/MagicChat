export type ChartDomain = {
  max: number
  min: number
}

export type ChartPoint = {
  x: number
  y: number
}

export function getChartDomain(
  values: (number | null)[],
  includeZero: boolean
): ChartDomain {
  const finiteValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  if (finiteValues.length === 0) return { max: 1, min: 0 }

  let min = Math.min(...finiteValues)
  let max = Math.max(...finiteValues)
  if (includeZero) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }

  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1
    return { max: max + padding, min: min - padding }
  }

  const padding = (max - min) * 0.08
  if (!includeZero || min < 0) min -= padding
  if (!includeZero || max > 0) max += padding
  return { max, min }
}

export function getChartTicks(domain: ChartDomain, count = 5) {
  if (count <= 1) return [domain.min]
  const step = (domain.max - domain.min) / (count - 1)
  return Array.from({ length: count }, (_, index) => domain.min + step * index)
}

export function scaleChartValue(
  value: number,
  domain: ChartDomain,
  rangeStart: number,
  rangeEnd: number
) {
  const progress = (value - domain.min) / (domain.max - domain.min)
  return rangeStart + progress * (rangeEnd - rangeStart)
}

export function createLinePathSegments(
  values: (number | null)[],
  pointAt: (value: number, index: number) => ChartPoint
) {
  const segments: string[] = []
  let current = ""

  values.forEach((value, index) => {
    if (value === null) {
      if (current) segments.push(current)
      current = ""
      return
    }
    const point = pointAt(value, index)
    current += `${current ? " L" : "M"}${round(point.x)} ${round(point.y)}`
  })
  if (current) segments.push(current)
  return segments
}

export function polarPoint(
  centerX: number,
  centerY: number,
  radius: number,
  angleDegrees: number
): ChartPoint {
  const angle = ((angleDegrees - 90) * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  }
}

export function createPieSlicePath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const sweep = Math.max(0, endAngle - startAngle)
  if (sweep >= 359.999) {
    const top = polarPoint(centerX, centerY, radius, 0)
    const bottom = polarPoint(centerX, centerY, radius, 180)
    return [
      `M ${round(centerX)} ${round(centerY)}`,
      `L ${round(top.x)} ${round(top.y)}`,
      `A ${radius} ${radius} 0 1 1 ${round(bottom.x)} ${round(bottom.y)}`,
      `A ${radius} ${radius} 0 1 1 ${round(top.x)} ${round(top.y)}`,
      "Z",
    ].join(" ")
  }

  const start = polarPoint(centerX, centerY, radius, startAngle)
  const end = polarPoint(centerX, centerY, radius, endAngle)
  const largeArc = sweep > 180 ? 1 : 0
  return [
    `M ${round(centerX)} ${round(centerY)}`,
    `L ${round(start.x)} ${round(start.y)}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${round(end.x)} ${round(end.y)}`,
    "Z",
  ].join(" ")
}

export function truncateChartLabel(value: string, limit = 8) {
  const characters = Array.from(value)
  return characters.length > limit
    ? `${characters.slice(0, limit).join("")}…`
    : value
}

export function formatChartValue(value: number) {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
