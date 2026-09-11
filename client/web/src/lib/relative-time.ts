const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "always",
})

const relativeTimeUnits = [
  { limit: 60, milliseconds: 1_000, unit: "second" },
  { limit: 60, milliseconds: 60_000, unit: "minute" },
  { limit: 24, milliseconds: 3_600_000, unit: "hour" },
  { limit: 30, milliseconds: 86_400_000, unit: "day" },
  { limit: 12, milliseconds: 2_592_000_000, unit: "month" },
  {
    limit: Number.POSITIVE_INFINITY,
    milliseconds: 31_536_000_000,
    unit: "year",
  },
] as const

export function formatRelativeTime(value: string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const difference = date.getTime() - now.getTime()
  const absoluteDifference = Math.abs(difference)
  if (absoluteDifference < 10_000) {
    return "刚刚"
  }

  for (const definition of relativeTimeUnits) {
    const amount = absoluteDifference / definition.milliseconds
    if (amount < definition.limit) {
      const roundedAmount = Math.max(1, Math.floor(amount))
      return relativeTimeFormatter
        .format(
          difference < 0 ? -roundedAmount : roundedAmount,
          definition.unit
        )
        .replace(/(\d)(?=\p{L})/u, "$1 ")
    }
  }

  return ""
}
