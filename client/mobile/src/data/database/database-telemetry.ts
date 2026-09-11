import type {
  DatabaseTelemetryBuildChannel,
  DatabaseTelemetryDurationBucket,
  DatabaseTelemetryErrorCategory,
  DatabaseTelemetryEvent,
  DatabaseTelemetryKind,
  DatabaseTelemetrySink,
} from "@/data/database/database-telemetry-types"

const SLOW_OPERATION_MS = 250
let sink: DatabaseTelemetrySink | undefined
let debugLoggingEnabled = false

export function databaseDurationBucket(durationMs: number): DatabaseTelemetryDurationBucket {
  if (durationMs < 16) return "fast"
  if (durationMs < 100) return "normal"
  if (durationMs < 1_000) return "slow"
  return "very-slow"
}

export function setDatabaseTelemetrySink(next: DatabaseTelemetrySink | undefined) {
  sink = next
}

export function setDatabaseTelemetryDebugLogging(enabled: boolean) {
  debugLoggingEnabled = enabled
}

export function databaseTelemetryBuildChannel(): DatabaseTelemetryBuildChannel {
  return typeof __DEV__ !== "undefined" && __DEV__ ? "debug" : "release"
}

/**
 * Emits only errors and slow operations in release. Successful fast operations are
 * intentionally dropped; aggregate sampling can be added by an injected sink later.
 * Sink and debug-console failures are isolated from application behavior.
 */
export function emitDatabaseTelemetry(input: {
  operation: string
  kind: DatabaseTelemetryKind
  queueDurationMs?: number
  executionDurationMs?: number
  errorCategory?: DatabaseTelemetryErrorCategory
  count?: number
  buildChannel?: DatabaseTelemetryBuildChannel
}) {
  const buildChannel = input.buildChannel ?? databaseTelemetryBuildChannel()
  const queueDurationMs = input.queueDurationMs ?? 0
  const executionDurationMs = input.executionDurationMs ?? 0
  const event: DatabaseTelemetryEvent = Object.freeze({
    operation: input.operation,
    kind: input.kind,
    queueDurationBucket: databaseDurationBucket(queueDurationMs),
    executionDurationBucket: databaseDurationBucket(executionDurationMs),
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    count: input.count ?? 1,
    buildChannel,
  })
  const shouldEmit = Boolean(input.errorCategory)
    || queueDurationMs >= SLOW_OPERATION_MS
    || executionDurationMs >= SLOW_OPERATION_MS
  if (shouldEmit) {
    try { sink?.(event) } catch { /* telemetry must not affect the database caller */ }
  }
  if (buildChannel === "debug" && debugLoggingEnabled) {
    try { console.debug("database_telemetry", event) } catch { /* best effort */ }
  }
}
