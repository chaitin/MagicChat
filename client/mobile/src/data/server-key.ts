import { normalizeServerUrl } from "@/core/server-model"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"

export { normalizeServerUrl } from "@/core/server-model"

export function createServerKey(server: ServerTarget) {
  return JSON.stringify([server.id, normalizeServerUrl(server.url)])
}

export function createAuthenticatedScopeKey(target: AuthenticatedTarget) {
  return [createServerKey(target), target.userId] as const
}
