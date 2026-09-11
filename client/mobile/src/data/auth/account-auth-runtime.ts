import type { AuthenticatedTarget } from "@/core/server-target"
import type { AccountStore } from "@/data/auth/account-store"
import type { AccountAuthSnapshot, ApiClientAuthOptions } from "@/data/api-client"

export type ActiveAccountRuntimeSnapshot = Readonly<{
  accountId: string
  generation: number
  target: AuthenticatedTarget
}>

/** Process-local authentication boundary. It deliberately never retains a token. */
export class AccountAuthRuntime {
  private active: ActiveAccountRuntimeSnapshot | null = null
  private preparing: ActiveAccountRuntimeSnapshot | null = null
  private onUnauthorized: ((accountId: string) => Promise<void>) | null = null

  private readonly store: Pick<AccountStore, "getCredential">
  constructor(store: Pick<AccountStore, "getCredential">) { this.store = store }

  install(snapshot: ActiveAccountRuntimeSnapshot | null) { this.active = snapshot; this.preparing = null }
  snapshot() { return this.active }
  prepare(snapshot: ActiveAccountRuntimeSnapshot) { this.preparing = snapshot }
  cancelPreparation(snapshot?: Pick<ActiveAccountRuntimeSnapshot, "accountId" | "generation">) {
    if (!snapshot || (this.preparing?.accountId === snapshot.accountId && this.preparing.generation === snapshot.generation)) this.preparing = null
  }
  setUnauthorizedHandler(handler: ((accountId: string) => Promise<void>) | null) { this.onUnauthorized = handler }
  isCurrent = (snapshot: Pick<AccountAuthSnapshot, "accountId" | "generation">) =>
    (this.active?.accountId === snapshot.accountId && this.active.generation === snapshot.generation) ||
    (this.preparing?.accountId === snapshot.accountId && this.preparing.generation === snapshot.generation)

  optionsFor(target: AuthenticatedTarget, expectedAccountId: string): ApiClientAuthOptions {
    return {
      auth: async () => {
        const active = this.active?.accountId === expectedAccountId ? this.active :
          this.preparing?.accountId === expectedAccountId ? this.preparing : null
        if (!active || active.accountId !== expectedAccountId ||
          active.target.id !== target.id || active.target.url !== target.url || active.target.userId !== target.userId) {
          throw new Error("请求目标不是当前账号")
        }
        const result = await this.store.getCredential(expectedAccountId)
        if (result.status !== "valid") throw new Error("账号凭据不可用，请重新登录")
        return { accountId: expectedAccountId, generation: active.generation, token: result.credential.token }
      },
      isCurrent: this.isCurrent,
      onUnauthorized: (accountId) => { void this.onUnauthorized?.(accountId) },
    }
  }

  optionsForStoredAccount(accountId: string, target: AuthenticatedTarget): ApiClientAuthOptions {
    const generation = this.active?.accountId === accountId ? this.active.generation : -1
    return {
      auth: async () => {
        const result = await this.store.getCredential(accountId)
        if (result.status !== "valid") throw new Error("账号凭据不可用，请重新登录")
        return { accountId, generation, token: result.credential.token }
      },
      isCurrent: (snapshot) => snapshot.accountId === accountId && snapshot.generation === generation,
    }
  }
}
