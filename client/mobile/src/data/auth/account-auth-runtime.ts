import type { AuthenticatedTarget } from "@/core/server-target"
import type { AccountStore, SessionCredential } from "@/data/auth/account-store"
import { MobileSessionCompatibilityError, refreshNativeSession } from "@/data/auth/auth-api"
import { ApiRequestError, StaleAccountOperationError } from "@/data/api-client"
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
  private readonly refreshTasks = new Map<string, Promise<SessionCredential>>()
  private readonly signingOutAccounts = new Set<string>()

  private readonly store: Pick<AccountStore, "getCredential" | "rotateCredential">
  private readonly refreshSession: typeof refreshNativeSession
  constructor(
    store: Pick<AccountStore, "getCredential" | "rotateCredential">,
    refreshSession: typeof refreshNativeSession = refreshNativeSession
  ) { this.store = store; this.refreshSession = refreshSession }

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

  private markReauth(accountId: string) {
    if (this.onUnauthorized) void this.onUnauthorized(accountId).catch(() => undefined)
  }

  async beginSignOut(accountId: string) {
    this.signingOutAccounts.add(accountId)
    try { await this.refreshTasks.get(accountId) } catch { /* A failed refresh still leaves logout responsible for local cleanup. */ }
    return () => { this.signingOutAccounts.delete(accountId) }
  }

  private async credentialFor(accountId: string, target: AuthenticatedTarget, force = false) {
    if (this.signingOutAccounts.has(accountId)) throw new Error("账号正在退出登录")
    const result = await this.store.getCredential(accountId)
    if (result.status !== "valid") throw new Error("账号凭据不可用，请重新登录")
    const current = result.credential
    if (this.signingOutAccounts.has(accountId)) throw new Error("账号正在退出登录")
    if (!force && Date.parse(current.expiresAt) > Date.now() + 5 * 60_000) return current
    const pending = this.refreshTasks.get(accountId)
    if (pending) return pending
    const task = (async () => {
      try {
        const next = await this.refreshSession(target.url, current.refreshToken)
        try {
          await this.store.rotateCredential(accountId, current.refreshToken, next)
        } catch (error) {
          this.markReauth(accountId)
          throw error
        }
        return next
      } catch (error) {
        if ((error instanceof ApiRequestError && error.status === 401) || error instanceof MobileSessionCompatibilityError) this.markReauth(accountId)
        throw error
      }
    })()
    this.refreshTasks.set(accountId, task)
    void task.finally(() => { if (this.refreshTasks.get(accountId) === task) this.refreshTasks.delete(accountId) }).catch(() => undefined)
    return task
  }

  optionsFor(target: AuthenticatedTarget, expectedAccountId: string): ApiClientAuthOptions {
    return {
      auth: async () => {
        const active = this.active?.accountId === expectedAccountId ? this.active :
          this.preparing?.accountId === expectedAccountId ? this.preparing : null
        if (!active || active.accountId !== expectedAccountId ||
          active.target.id !== target.id || active.target.url !== target.url || active.target.userId !== target.userId) {
          throw new Error("请求目标不是当前账号")
        }
        const credential = await this.credentialFor(expectedAccountId, target)
        if (!this.isCurrent(active)) throw new StaleAccountOperationError(expectedAccountId)
        return { accountId: expectedAccountId, generation: active.generation, token: credential.token }
      },
      isCurrent: this.isCurrent,
      refresh: async (snapshot) => {
        const current = await this.store.getCredential(expectedAccountId)
        if (current.status === "valid" && current.credential.token !== snapshot.token) return { ...snapshot, token: current.credential.token }
        const credential = await this.credentialFor(expectedAccountId, target, true)
        return { ...snapshot, token: credential.token }
      },
      onUnauthorized: (accountId) => { this.markReauth(accountId) },
    }
  }

  optionsForStoredAccount(accountId: string, target: AuthenticatedTarget): ApiClientAuthOptions {
    const generation = this.active?.accountId === accountId ? this.active.generation : -1
    return {
      auth: async () => {
        const credential = await this.credentialFor(accountId, target)
        return { accountId, generation, token: credential.token }
      },
      isCurrent: (snapshot) => snapshot.accountId === accountId && snapshot.generation === generation,
      refresh: async (snapshot) => {
        const current = await this.store.getCredential(accountId)
        if (current.status === "valid" && current.credential.token !== snapshot.token) return { ...snapshot, token: current.credential.token }
        return { ...snapshot, token: (await this.credentialFor(accountId, target, true)).token }
      },
    }
  }
}
