export type PushServerStatus = "active" | "disabled"

export type PushServer = {
  createdAt: string
  dailyLimit: number
  id: string
  keyFingerprint: string
  lastUsedAt: string | null
  name: string
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

export const MOCK_SERVER_KEYS: Record<string, string> = {
  srv_prod_cn_01: "mcps_srv_prod_cn_01_demo8n4k2q5x7c9v3m6a1s4d",
  srv_staging_01: "mcps_srv_staging_01_demoq2mx7v4c8n1k5a9s3d6f",
  srv_dev_02: "mcps_srv_dev_02_demo7jpc4m8x2v6n1k9a5s3d",
}

export const MOCK_SERVERS: PushServer[] = [
  {
    createdAt: "2026-08-21T09:20:00+08:00",
    dailyLimit: 100_000,
    id: "srv_prod_cn_01",
    keyFingerprint: "…8N4K",
    lastUsedAt: "2026-09-09T18:42:00+08:00",
    name: "生产环境一号",
    status: "active",
    todayUsage: 38_642,
  },
  {
    createdAt: "2026-08-28T14:05:00+08:00",
    dailyLimit: 20_000,
    id: "srv_staging_01",
    keyFingerprint: "…Q2MX",
    lastUsedAt: "2026-09-09T17:16:00+08:00",
    name: "预发布环境",
    status: "active",
    todayUsage: 1_284,
  },
  {
    createdAt: "2026-09-02T11:30:00+08:00",
    dailyLimit: 5_000,
    id: "srv_dev_02",
    keyFingerprint: "…7JPC",
    lastUsedAt: "2026-09-08T20:31:00+08:00",
    name: "移动端联调",
    status: "disabled",
    todayUsage: 0,
  },
]

export function createMockServer(draft: PushServerDraft): IssuedServerKey {
  const suffix = randomToken(6).toLowerCase()
  const secret = randomToken(36)
  const server: PushServer = {
    createdAt: new Date().toISOString(),
    dailyLimit: draft.dailyLimit,
    id: `srv_${suffix}`,
    keyFingerprint: `…${secret.slice(-4)}`,
    lastUsedAt: null,
    name: draft.name.trim(),
    status: "active",
    todayUsage: 0,
  }
  return { key: `mcps_${server.id}_${secret}`, server }
}

export function rotateMockServerKey(server: PushServer): IssuedServerKey {
  const secret = randomToken(36)
  return {
    key: `mcps_${server.id}_${secret}`,
    server: { ...server, keyFingerprint: `…${secret.slice(-4)}` },
  }
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

export function maskServerKey(key: string) {
  if (key.length <= 16) return "••••••••"
  return `${key.slice(0, 12)}${"•".repeat(16)}${key.slice(-4)}`
}

export function formatLastUsed(value: string | null) {
  if (!value) return "尚未使用"
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value))
}

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (value) => (value % 36).toString(36)).join("")
}
