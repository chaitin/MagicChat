import type { AccountRecord } from "@/data/auth/account-store"
import type { ServerTarget } from "@/core/server-target"

export type AccountListItem = {
  accountId: string
  accessibilityLabel: string
  avatar: string
  email: string
  isCurrent: boolean
  name: string
  status: "current" | "ready" | "reauth-required"
  target: { id: string; url: string; userId: string }
}

export function buildAccountListItems(
  accounts: readonly AccountRecord[],
  activeAccountId: string | null
): AccountListItem[] {
  return [...accounts]
    .sort((left, right) => {
      if (left.id === activeAccountId) return -1
      if (right.id === activeAccountId) return 1
      return Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) || left.id.localeCompare(right.id)
    })
    .map((account) => {
      const isCurrent = account.id === activeAccountId
      const status = isCurrent ? "current" as const : account.status === "reauth-required" ? "reauth-required" as const : "ready" as const
      const name = account.name.trim() || account.email?.trim() || account.userId
      const statusLabel = status === "current" ? "当前账号" : status === "reauth-required" ? "需要重新登录" : "可切换"
      return {
        accountId: account.id,
        accessibilityLabel: `${account.email ?? name}，${account.url}，${statusLabel}`,
        avatar: account.avatar?.trim() ?? "",
        email: account.email?.trim() || name,
        isCurrent,
        name,
        status,
        target: { id: account.serverId, url: account.url, userId: account.userId },
      }
    })
}

export function resolveLoginTarget({ accounts, accountId, authHydrated = true, mode, selectedServer }: {
  accounts: readonly AccountRecord[]
  accountId: string | undefined
  authHydrated?: boolean
  mode: string | undefined
  selectedServer: ServerTarget
}): { account: AccountRecord | null; invalidReauth: boolean; pendingReauth: boolean; target: ServerTarget } {
  if (mode !== "reauth") return { account: null, invalidReauth: false, pendingReauth: false, target: selectedServer }
  if (!authHydrated) return { account: null, invalidReauth: false, pendingReauth: true, target: selectedServer }
  const account = accountId ? accounts.find((candidate) => candidate.id === accountId) ?? null : null
  if (!account) return { account: null, invalidReauth: true, pendingReauth: false, target: selectedServer }
  return { account, invalidReauth: false, pendingReauth: false, target: { id: account.serverId, url: account.url } }
}

export function isAccountLoginMode(mode: string | undefined) {
  return mode === "add-account" || mode === "reauth"
}
export function shouldRedirectAuthenticatedLogin(isAuthenticated: boolean, mode: string | undefined) {
  return isAuthenticated && !isAccountLoginMode(mode)
}
export function parseServerManagementMode(mode: string | undefined) {
  return mode === "add-account" ? "add-account" as const : mode === "manage" ? "manage" as const : "default" as const
}

export function accountLoginHref(accountId: string) {
  return `/login?mode=reauth&returnTo=account-management&accountId=${encodeURIComponent(accountId)}`
}
export function addAccountServerHref() {
  return "/server-management?mode=add-account&returnTo=account-management"
}
export function loginForSelectedServerHref() {
  return "/login?mode=add-account&returnTo=account-management"
}

export async function performAccountSwitch({ accountId, currentAccountId, navigate, switchAccount }: {
  accountId: string
  currentAccountId: string | null
  navigate: () => void
  switchAccount: (accountId: string) => Promise<void>
}) {
  if (accountId === currentAccountId) return false
  await switchAccount(accountId)
  navigate()
  return true
}

export async function performAccountLogout({ accountId, navigate, signOutAccount }: {
  accountId: string
  navigate: () => void
  signOutAccount: (accountId: string) => Promise<void>
}) {
  await signOutAccount(accountId)
  navigate()
}

export class AccountActionSingleFlight {
  private activeAccountId: string | null = null
  get active() { return this.activeAccountId }
  async run<T>(accountId: string, operation: () => Promise<T>): Promise<T | undefined> {
    if (this.activeAccountId) return undefined
    this.activeAccountId = accountId
    try { return await operation() }
    finally { this.activeAccountId = null }
  }
}
