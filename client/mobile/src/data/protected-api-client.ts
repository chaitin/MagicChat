import type { AuthenticatedTarget } from "@/core/server-target"
import { createApiClient, type ApiFetch } from "@/data/api-client"
import { createAccountId } from "@/data/auth/account-store"
import { getAccountAuthRuntime } from "@/data/auth/account-runtime-registry"

/** The only client constructor for protected /api/client endpoints. */
export function createProtectedApiClient(target: AuthenticatedTarget, fetcher?: ApiFetch) {
  return createApiClient(target.url, fetcher, {
    auth: getAccountAuthRuntime().optionsFor(target, createAccountId(target.url, target.userId)),
  })
}

/** Explicit inactive-account boundary for narrowly scoped account-owned cleanup and metadata reads. */
export function createStoredAccountApiClient(target: AuthenticatedTarget, accountId: string, fetcher?: ApiFetch) {
  if (createAccountId(target.url, target.userId) !== accountId) throw new Error("账号与 Push 目标不匹配")
  return createApiClient(target.url, fetcher, {
    auth: getAccountAuthRuntime().optionsForStoredAccount(accountId, target),
  })
}
