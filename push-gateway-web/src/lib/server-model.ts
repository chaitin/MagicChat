export type PushServerStatus = "active" | "disabled"

export type PushServer = {
  createdAt: string
  dailyLimit: number
  id: string
  name: string
  revision: number
  status: PushServerStatus
  todayUsage: number
}

export type PushServerDraft = {
  dailyLimit: number
  name: string
}

export type IssuedServerKey = {
  key: string
  server: PushServer
}

export function quotaUsagePercent(server: PushServer) {
  if (server.dailyLimit <= 0) return 100
  return Math.min(
    100,
    Math.round((server.todayUsage / server.dailyLimit) * 100)
  )
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value)
}
