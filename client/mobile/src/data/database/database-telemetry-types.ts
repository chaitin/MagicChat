export type DatabaseTelemetryKind =
  | "read"
  | "write"
  | "transaction"
  | "maintenance"
  | "message-cache"

export type DatabaseTelemetryDurationBucket = "fast" | "normal" | "slow" | "very-slow"
export type DatabaseTelemetryErrorCategory = "busy" | "constraint" | "io" | "closed" | "unknown"
export type DatabaseTelemetryBuildChannel = "debug" | "release"

/** Deliberately closed metadata shape. Identifiers, SQL and raw errors cannot be represented. */
export interface DatabaseTelemetryEvent {
  operation: string
  kind: DatabaseTelemetryKind
  queueDurationBucket: DatabaseTelemetryDurationBucket
  executionDurationBucket: DatabaseTelemetryDurationBucket
  errorCategory?: DatabaseTelemetryErrorCategory
  count: number
  buildChannel: DatabaseTelemetryBuildChannel
}

export type DatabaseTelemetrySink = (event: Readonly<DatabaseTelemetryEvent>) => void
