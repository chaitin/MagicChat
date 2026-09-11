import type { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"

let runtime: AccountAuthRuntime | null = null
export function installAccountAuthRuntime(value: AccountAuthRuntime) { runtime = value }
export function getAccountAuthRuntime() {
  if (!runtime) throw new Error("账号认证 runtime 尚未水合")
  return runtime
}
