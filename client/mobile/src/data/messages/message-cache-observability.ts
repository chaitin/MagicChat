import type { AuthenticatedTarget } from "@/core/server-target"
import { classifyDatabaseError } from "@/data/database/database-service"
import { emitDatabaseTelemetry } from "@/data/database/database-telemetry"

/** Compatibility facade; all cache telemetry is emitted by the redacting database adapter. */
export function reportMessageCacheError(input: {
  target: AuthenticatedTarget
  conversationId: string
  messageCount: number
  operation: string
  error: unknown
}) {
  emitDatabaseTelemetry({
    operation: input.operation,
    kind: "message-cache",
    errorCategory: classifyDatabaseError(input.error),
    count: input.messageCount || 1,
  })
}
