import type { AuthenticatedTarget } from "@/core/server-target"
import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { createAccountId } from "@/data/auth/account-store"
import { installAccountAuthRuntime } from "@/data/auth/account-runtime-registry"

export function installTestAccountRuntime(target: AuthenticatedTarget) {
  const accountId = createAccountId(target.url, target.userId)
  const runtime = new AccountAuthRuntime({
    getCredential: async () => ({ status: "valid", credential: { token: "test-session-token", expiresAt: "2099-01-01T00:00:00.000Z" } }),
  })
  runtime.install({ accountId, generation: 1, target })
  installAccountAuthRuntime(runtime)
  return target
}
