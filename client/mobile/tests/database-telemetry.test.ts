import assert from "node:assert/strict"
import test from "node:test"

import {
  emitDatabaseTelemetry,
  setDatabaseTelemetryDebugLogging,
  setDatabaseTelemetrySink,
} from "@/data/database/database-telemetry"
import type { DatabaseTelemetryEvent } from "@/data/database/database-telemetry-types"

test.afterEach(() => {
  setDatabaseTelemetrySink(undefined)
  setDatabaseTelemetryDebugLogging(false)
})

test("telemetry exposes only the closed redacted metadata shape", () => {
  const events: DatabaseTelemetryEvent[] = []
  setDatabaseTelemetrySink((event) => events.push(event))
  emitDatabaseTelemetry({
    operation: "messages.cache.read",
    kind: "message-cache",
    executionDurationMs: 300,
    errorCategory: "unknown",
    buildChannel: "release",
  })
  assert.equal(events.length, 1)
  assert.deepEqual(Object.keys(events[0]).sort(), [
    "buildChannel", "count", "errorCategory", "executionDurationBucket", "kind",
    "operation", "queueDurationBucket",
  ])
  const keys = Object.keys(events[0]).map((key) => key.toLowerCase())
  for (const forbidden of ["url", "userid", "conversationid", "messageid", "sql", "bind", "stack", "message"]) {
    assert.equal(keys.includes(forbidden), false)
  }
})

test("sink failures are isolated", () => {
  setDatabaseTelemetrySink(() => { throw new Error("sink failed") })
  assert.doesNotThrow(() => emitDatabaseTelemetry({
    operation: "database.read", kind: "read", errorCategory: "io", buildChannel: "release",
  }))
})

test("release drops successful fast operations and emits errors or slow operations", () => {
  const events: DatabaseTelemetryEvent[] = []
  setDatabaseTelemetrySink((event) => events.push(event))
  emitDatabaseTelemetry({ operation: "fast", kind: "read", executionDurationMs: 20, buildChannel: "release" })
  emitDatabaseTelemetry({ operation: "slow", kind: "read", executionDurationMs: 250, buildChannel: "release" })
  emitDatabaseTelemetry({ operation: "failed", kind: "write", errorCategory: "constraint", buildChannel: "release" })
  assert.deepEqual(events.map((event) => event.operation), ["slow", "failed"])
})
