import type { AuthenticatedTarget } from "@/core/server-target"
import { createAccountId } from "@/data/auth/account-store"
import { createDefaultAccountStore } from "@/data/auth/account-store.native"
import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { installAccountAuthRuntime } from "@/data/auth/account-runtime-registry"

export const accountStore = createDefaultAccountStore()
export const accountAuthRuntime = new AccountAuthRuntime(accountStore)
installAccountAuthRuntime(accountAuthRuntime)

export function accountIdForTarget(target: AuthenticatedTarget) {
  return createAccountId(target.url, target.userId)
}
