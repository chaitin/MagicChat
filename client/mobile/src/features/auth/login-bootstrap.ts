import type { QueryClient } from "@tanstack/react-query"

import type { AuthenticatedTarget } from "@/core/server-target"
import {
  LOGIN_BOOTSTRAP_MAX_ATTEMPTS,
  LOGIN_BOOTSTRAP_REALTIME_TIMEOUT_MS,
} from "@/features/auth/login-bootstrap-constants"
import {
  createSessionBootstrapOperations,
  sessionBootstrapCoordinator,
} from "@/features/bootstrap/session-bootstrap"

export { LOGIN_BOOTSTRAP_MAX_ATTEMPTS, LOGIN_BOOTSTRAP_REALTIME_TIMEOUT_MS }

/** Compatibility facade used by the login flow. */
export function runLoginBootstrap({
  queryClient,
  target,
  waitForRealtime,
}: {
  queryClient: QueryClient
  target: AuthenticatedTarget
  waitForRealtime: (
    target: AuthenticatedTarget,
    options: { attempts: number; timeoutMs: number }
  ) => Promise<void>
}) {
  return Promise.all([
    sessionBootstrapCoordinator.start(
      target,
      createSessionBootstrapOperations({ queryClient, target })
    ),
    waitForRealtime(target, {
      attempts: LOGIN_BOOTSTRAP_MAX_ATTEMPTS,
      timeoutMs: LOGIN_BOOTSTRAP_REALTIME_TIMEOUT_MS,
    }),
  ]).then(() => undefined)
}
