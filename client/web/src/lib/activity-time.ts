export function formatActivityTime(
  activityAt: string | null,
  now = new Date()
) {
  if (!activityAt) {
    return ""
  }

  const date = new Date(activityAt)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  if (!isSameLocalDay(date, now)) {
    return `${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date)
}

export function formatDocumentModifiedTime(modifiedAt: string | null) {
  if (!modifiedAt) return ""
  const date = new Date(modifiedAt)
  if (Number.isNaN(date.getTime())) return ""
  return `修改于 ${date.getFullYear()}-${formatMonthDay(date)} ${formatHourMinute(date)}`
}

function isSameLocalDay(date: Date, otherDate: Date) {
  return (
    date.getFullYear() === otherDate.getFullYear() &&
    date.getMonth() === otherDate.getMonth() &&
    date.getDate() === otherDate.getDate()
  )
}

function formatMonthDay(date: Date) {
  return `${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function formatHourMinute(date: Date) {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}
