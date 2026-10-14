type StartupPhase =
  | "database.open.start"
  | "database.open.ready"
  | "database.initialize"
  | "database.previews"
  | "database.previews.sync_probe"
  | "database.messages"
  | "database.conversations"
  | "database.maintenance"
  | "previews.load.start"
  | "previews.load.ready"
  | "previews.load.discarded"
  | "previews.load.failed"
  | "messages.list.commit"
  | "bootstrap.local.start"
  | "bootstrap.local.ready"
  | "bootstrap.local.skipped"
  | "bootstrap.local.failed"
  | "bootstrap.network.start"
  | "bootstrap.network.ready"

type StartupMetrics = Partial<Record<
  "elapsedMs" | "count" | "loaded" | "queueMs" | "executionMs" | "failures",
  number
>>

const metricNames = ["elapsedMs", "count", "loaded", "queueMs", "executionMs", "failures"] as const

export function createMobileStartupTracer({
  enabled,
  now = () => performance.now(),
  log = (line: string) => console.info(line),
}: {
  enabled: boolean
  now?: () => number
  log?: (line: string) => void
}) {
  const startedAt = now()
  return (phase: StartupPhase, metrics: StartupMetrics = {}) => {
    if (!enabled) return
    try {
      const values: StartupMetrics = {}
      for (const name of metricNames) {
        const value = metrics[name]
        if (typeof value === "number" && Number.isFinite(value)) values[name] = Math.round(value)
      }
      log(`[mobile-startup] ${JSON.stringify({ phase, atMs: Math.round(now() - startedAt), ...values })}`)
    } catch { /* Diagnostics must not affect startup. */ }
  }
}

export const traceMobileStartup = createMobileStartupTracer({
  enabled: process.env.EXPO_PUBLIC_MOBILE_PERF === "1",
})
