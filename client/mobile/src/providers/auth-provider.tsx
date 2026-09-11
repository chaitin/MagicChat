import AsyncStorage from "@react-native-async-storage/async-storage"
import { useQueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import type { AuthenticatedUser } from "@/core/models"
import type { AuthenticatedTarget, ServerTarget } from "@/core/server-target"
import type { ActiveAccountRuntimeSnapshot } from "@/data/auth/account-auth-runtime"
import { migrateLegacyAccount } from "@/data/auth/account-migration"
import { createAccountRecord, type AccountIndexV2, type AccountRecord } from "@/data/auth/account-store"
import { accountAuthRuntime, accountStore } from "@/data/auth/account-runtime-instance"
import { logout, type MobileSessionCredential } from "@/data/auth/auth-api"
import { deactivateCurrentAccount } from "@/data/auth/account-deactivation-api"
import { isSafeAccountDeactivationRejection } from "@/data/auth/account-deactivation-failure"
import { createSessionBootstrapOperations, sessionBootstrapCoordinator } from "@/features/bootstrap/session-bootstrap"
import { migrateLegacyLoginAssistance } from "@/data/auth/credential-store"
import { runAccountSignOutTransaction, selectRecentReadyAccount } from "@/data/auth/sign-out-transaction"
import { runInstallAccountTransaction } from "@/data/auth/install-account-transaction"
import { fetchStoredCurrentUser } from "@/data/users/current-user-api"
import { queryKeys } from "@/data/query"
import type { PushAccountIdentity } from "@/notifications/push-types"
import { usePushCoordinator } from "@/providers/push-coordinator-provider"

export type AuthSession = AuthenticatedTarget
export type AuthPhase = "anonymous" | "preparing" | "switching" | "authenticated" | "signing-out" | "degraded"
export type ActiveAccountSnapshot = ActiveAccountRuntimeSnapshot & { account: AccountRecord }

type AuthContextValue = {
  accounts: AccountRecord[]
  active: ActiveAccountSnapshot | null
  activeAccount: AccountRecord | null
  generation: number
  phase: AuthPhase
  switchAccount(accountId: string): Promise<void>
  signOutAccount(accountId: string, localOnly?: boolean): Promise<void>
  deactivateActiveAccount(code: string): Promise<string | null>
  markReauthRequired(accountId: string): Promise<void>
  refreshMissingAccountProfiles(): Promise<void>
  installAndActivate(server: ServerTarget, user: AuthenticatedUser, credential: MobileSessionCredential): Promise<void>
  // Transitional, non-persisting API for the existing login screen.
  beginSignIn(session: AuthSession): void
  commitSignIn(session: AuthSession): Promise<void>
  rollbackSignIn(session: AuthSession): Promise<void>
  invalidateSession(): Promise<void>
  signOut(): Promise<string | null>
  isAuthenticated: boolean
  isHydrated: boolean
  isPreparingSignIn: boolean
  isSigningOut: boolean
  session: AuthSession | null
}
const AuthContext = createContext<AuthContextValue | null>(null)
const EMPTY: AccountIndexV2 = { version: 2, accounts: [], activeAccountId: null, revision: 0, pendingCredentialCleanup: [] }

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient()
  const pushCoordinator = usePushCoordinator()
  const [index, setIndex] = useState(EMPTY)
  const [active, setActive] = useState<ActiveAccountSnapshot | null>(null)
  const [phase, setPhase] = useState<AuthPhase>("preparing")
  const [hydrated, setHydrated] = useState(false)
  const stateRef = useRef({ index: EMPTY, active: null as ActiveAccountSnapshot | null, generation: 0 })
  const queueRef = useRef(Promise.resolve<unknown>(undefined))
  const stagedRef = useRef<AuthSession | null>(null)

  const publish = useCallback((nextIndex: AccountIndexV2, nextActive: ActiveAccountSnapshot | null, nextPhase: AuthPhase) => {
    stateRef.current = { index: nextIndex, active: nextActive, generation: nextActive?.generation ?? stateRef.current.generation }
    accountAuthRuntime.install(nextActive)
    setIndex(nextIndex); setActive(nextActive); setPhase(nextPhase)
  }, [])
  const serialize = useCallback(<T,>(operation: () => Promise<T>) => {
    const result = queueRef.current.then(operation, operation)
    queueRef.current = result.then(() => undefined, () => undefined)
    return result
  }, [])
  const targetOf = (account: AccountRecord): AuthenticatedTarget => ({ id: account.serverId, url: account.url, userId: account.userId })
  const pushIdentityOf = (snapshot: ActiveAccountSnapshot): PushAccountIdentity => ({
    accountId: snapshot.accountId,
    generation: snapshot.generation,
    target: snapshot.target,
  })
  const beginBootstrap = useCallback((account: AccountRecord) => {
    const target = targetOf(account)
    const preparation = { accountId: account.id, target, generation: stateRef.current.generation + 1 }
    accountAuthRuntime.prepare(preparation)
    sessionBootstrapCoordinator.invalidate(target)
    const completion = sessionBootstrapCoordinator.start(
      target,
      createSessionBootstrapOperations({ queryClient, target })
    )
    return { completion, preparation }
  }, [queryClient])
  const bootstrapBeforeCommit = useCallback(async (account: AccountRecord) => {
    const { completion, preparation } = beginBootstrap(account)
    try {
      await completion
      return preparation
    } catch (error) {
      sessionBootstrapCoordinator.invalidate(preparation.target)
      accountAuthRuntime.cancelPreparation(preparation)
      throw error
    }
  }, [beginBootstrap])

  useEffect(() => {
    let mounted = true
    void (async () => {
      await migrateLegacyAccount({ storage: AsyncStorage, accountStore, migrateLoginAssistance: (target, account) => migrateLegacyLoginAssistance(target, account.id) })
      const next = await accountStore.hydrate()
      if (!mounted) return
      const account = next.accounts.find((item) => item.id === next.activeAccountId && item.status === "ready")
      if (!account) { publish(next, null, "anonymous"); return }
      const credential = await accountStore.getCredential(account.id)
      if (credential.status !== "valid") {
        publish(next, null, "anonymous")
        return
      }

      const target = targetOf(account)
      queryClient.setQueryData(queryKeys.currentUser(target), {
        avatar: account.avatar ?? "",
        email: account.email ?? "",
        id: account.userId,
        name: account.name,
      })
      const { completion, preparation } = beginBootstrap(account)
      const snapshot = { accountId: account.id, account, target, generation: preparation.generation }
      publish(next, snapshot, "authenticated")
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeys.currentUser(target),
      })
      void completion.catch(() => undefined)
    })().catch(async () => { if (mounted) publish(await accountStore.hydrate().catch(() => EMPTY), null, "degraded") }).finally(() => { if (mounted) setHydrated(true) })
    return () => { mounted = false; accountAuthRuntime.setUnauthorizedHandler(null) }
  }, [beginBootstrap, publish, queryClient])

  const markReauthRequired = useCallback((accountId: string) => serialize(async () => {
    await accountStore.markReauthRequired(accountId)
    const next = await accountStore.hydrate()
    const current = stateRef.current.active
    if (current?.accountId === accountId) {
      sessionBootstrapCoordinator.invalidate(current.target)
      publish(next, null, "anonymous")
    } else publish(next, current, current ? "authenticated" : "anonymous")
  }), [publish, serialize])
  useEffect(() => { accountAuthRuntime.setUnauthorizedHandler(markReauthRequired) }, [markReauthRequired])

  const switchAccount = useCallback((accountId: string) => serialize(async () => {
    const old = stateRef.current.active
    if (old?.accountId === accountId) return
    setPhase("switching")
    const before = await accountStore.hydrate()
    const account = before.accounts.find((item) => item.id === accountId)
    if (!account) { setPhase(old ? "authenticated" : "anonymous"); throw new Error("账号不存在") }
    const credential = await accountStore.getCredential(accountId)
    if (credential.status !== "valid") {
      await accountStore.markReauthRequired(accountId); setIndex(await accountStore.hydrate())
      setPhase(old ? "authenticated" : "anonymous"); throw new Error("账号需要重新登录")
    }
    try {
      const preparation = await bootstrapBeforeCommit(account)
      await accountStore.commitActive(accountId, before.revision)
      const next = await accountStore.hydrate()
      const generation = preparation.generation
      old && sessionBootstrapCoordinator.invalidate(old.target)
      publish(next, { accountId, account: next.accounts.find((a) => a.id === accountId)!, target: targetOf(account), generation }, "authenticated")
    } catch (error) {
      const persisted = await accountStore.hydrate()
      const persistedAccount = persisted.accounts.find((item) => item.id === persisted.activeAccountId && item.status === "ready")
      if (persistedAccount && persisted.activeAccountId !== old?.accountId) {
        const reconciled = await bootstrapBeforeCommit(persistedAccount)
        const snapshot = { accountId: persistedAccount.id, account: persistedAccount, target: targetOf(persistedAccount), generation: reconciled.generation }
        publish(persisted, snapshot, "authenticated")
      } else publish(persisted, old, old ? "authenticated" : "anonymous")
      throw error
    }
  }), [bootstrapBeforeCommit, publish, serialize])

  const signOutAccount = useCallback((accountId: string, localOnly = false) => serialize(async () => {
    const old = stateRef.current.active
    if (old?.accountId === accountId) pushCoordinator.pause()
    setPhase("signing-out")
    const before = await accountStore.hydrate()
    const account = before.accounts.find((item) => item.id === accountId)
    if (!account) { setPhase(old ? "authenticated" : "anonymous"); return }
    const isCurrent = old?.accountId === accountId
    const pushIdentity = isCurrent ? pushIdentityOf(old) : { accountId, generation: -1, target: targetOf(account) }
    const candidate = isCurrent ? selectRecentReadyAccount(before.accounts, accountId) : undefined
    await runAccountSignOutTransaction({
      isCurrent,
      prepareCandidate: () => candidate ? bootstrapBeforeCommit(candidate) : Promise.resolve(undefined),
      cancelPreparation: (preparation) => accountAuthRuntime.cancelPreparation(preparation),
      logout: async () => {
        if (localOnly) {
          await pushCoordinator.deactivate(pushIdentity)
          return false
        }
        const pushInstallationId = await pushCoordinator.getInstallationId(pushIdentity)
        await logout(account.url, {
          account: { accountId, auth: accountAuthRuntime.optionsForStoredAccount(accountId, targetOf(account)) },
          pushInstallationId,
        })
        return true
      },
      afterLogout: async (remoteInvalidated) => {
        if (remoteInvalidated) await pushCoordinator.queueRevocation(pushIdentity, true)
      },
      remove: async () => {
        if (isCurrent) sessionBootstrapCoordinator.invalidate(old.target)
        await accountStore.removeAccount(accountId)
      },
      commitCandidate: async () => {
        const next = await accountStore.hydrate()
        await accountStore.commitActive(candidate!.id, next.revision)
      },
      onSuccess: async (preparation) => {
        const next = await accountStore.hydrate()
        if (candidate && preparation) {
          const snapshot = { accountId: candidate.id, account: candidate, target: targetOf(candidate), generation: preparation.generation }
          publish(next, snapshot, "authenticated")
        } else publish(next, isCurrent ? null : old, isCurrent ? "anonymous" : "authenticated")
      },
      onSafeRollback: async () => {
        publish(await accountStore.hydrate(), old, old ? "authenticated" : "anonymous")
      },
      onUnsafeFailure: async () => {
        await accountStore.markReauthRequired(accountId).catch(() => undefined)
        publish(await accountStore.hydrate().catch(() => before), null, "degraded")
      },
    })
  }), [bootstrapBeforeCommit, publish, pushCoordinator, serialize])

  const deactivateActiveAccount = useCallback((code: string) => serialize(async () => {
    const old = stateRef.current.active
    if (!old) throw new Error("当前账号已失效")
    const accountId = old.accountId
    pushCoordinator.pause()
    setPhase("signing-out")
    const before = await accountStore.hydrate()
    const candidate = selectRecentReadyAccount(before.accounts, accountId)
    await runAccountSignOutTransaction({
      isCurrent: true,
      prepareCandidate: () => candidate ? bootstrapBeforeCommit(candidate) : Promise.resolve(undefined),
      cancelPreparation: (preparation) => accountAuthRuntime.cancelPreparation(preparation),
      logout: async () => {
        await deactivateCurrentAccount(old.target, old.accountId, code)
        return true
      },
      // The endpoint already revoked every server Push grant; bookkeeping must
      // never block deletion of the local account credential.
      afterLogout: async () => undefined,
      remove: async () => {
        sessionBootstrapCoordinator.invalidate(old.target)
        await accountStore.removeAccount(accountId)
      },
      commitCandidate: async () => {
        const next = await accountStore.hydrate()
        await accountStore.commitActive(candidate!.id, next.revision)
      },
      onSuccess: async (preparation) => {
        const next = await accountStore.hydrate()
        if (candidate && preparation) {
          const currentCandidate = next.accounts.find((item) => item.id === candidate.id)!
          publish(next, { accountId: candidate.id, account: currentCandidate, target: targetOf(currentCandidate), generation: preparation.generation }, "authenticated")
        } else publish(next, null, "anonymous")
      },
      onSafeRollback: async (error) => {
        if (isSafeAccountDeactivationRejection(error)) {
          publish(await accountStore.hydrate(), old, "authenticated")
          return
        }
        await accountStore.markReauthRequired(accountId).catch(() => undefined)
        publish(await accountStore.hydrate().catch(() => before), null, "degraded")
      },
      onUnsafeFailure: async () => {
        await accountStore.markReauthRequired(accountId).catch(() => undefined)
        publish(await accountStore.hydrate().catch(() => before), null, "degraded")
      },
    })
    return candidate?.id ?? null
  }), [bootstrapBeforeCommit, publish, pushCoordinator, serialize])

  const installAndActivate = useCallback((server: ServerTarget, user: AuthenticatedUser, credential: MobileSessionCredential) => serialize(async () => {
    const old = stateRef.current.active
    setPhase("preparing")
    const record = createAccountRecord({ serverId: server.id, url: server.url, userId: user.id, avatar: user.avatar, name: user.name, email: user.email, lastUsedAt: new Date().toISOString(), status: "ready" })
    const before = await accountStore.hydrate()
    const previousRecord = before.accounts.find((item) => item.id === record.id)
    const previousCredential = previousRecord ? await accountStore.getCredential(record.id) : null
    await runInstallAccountTransaction({
      install: () => accountStore.installAccount(record, credential),
      bootstrap: () => bootstrapBeforeCommit(record),
      cancelPreparation: (preparation) => accountAuthRuntime.cancelPreparation(preparation),
      commit: async () => {
        const installed = await accountStore.hydrate()
        await accountStore.commitActive(record.id, installed.revision)
      },
      publish: async (preparation) => {
        const next = await accountStore.hydrate()
        old && sessionBootstrapCoordinator.invalidate(old.target)
        publish(next, { accountId: record.id, account: next.accounts.find((a) => a.id === record.id)!, target: targetOf(record), generation: preparation.generation }, "authenticated")
      },
      revokeNewSession: () => logout(server.url, { account: { accountId: record.id, auth: {
        auth: async () => ({ accountId: record.id, generation: -1, token: credential.token }),
        isCurrent: (snapshot) => snapshot.accountId === record.id && snapshot.generation === -1,
      } } }),
      restore: async () => {
        if (previousRecord) {
          const previousValue = previousCredential?.status === "valid" ? previousCredential.credential : null
          await accountStore.restoreAccount(previousRecord, previousValue)
        } else await accountStore.removeAccount(record.id)
        const restored = await accountStore.hydrate()
        if (old && restored.activeAccountId !== old.accountId) await accountStore.commitActive(old.accountId, restored.revision)
        publish(await accountStore.hydrate(), old, old ? "authenticated" : "anonymous")
      },
      onRestoreFailure: async () => {
        publish(await accountStore.hydrate().catch(() => before), null, "degraded")
      },
    })
  }), [bootstrapBeforeCommit, publish, serialize])

  const invalidateSession = useCallback(async () => { const id = stateRef.current.active?.accountId; if (id) await markReauthRequired(id) }, [markReauthRequired])
  const refreshMissingAccountProfiles = useCallback(async () => {
    const candidates = stateRef.current.index.accounts.filter((account) => !account.avatar && account.status === "ready")
    const profiles: { accountId: string; avatar: string; email: string; name: string; userId: string }[] = []
    for (let offset = 0; offset < candidates.length; offset += 3) {
      const batch = await Promise.all(candidates.slice(offset, offset + 3).map(async (account) => {
        try {
          const profile = await fetchStoredCurrentUser(targetOf(account), account.id)
          if (profile.id !== account.userId || !profile.avatar) return null
          return { accountId: account.id, avatar: profile.avatar, email: profile.email, name: profile.name, userId: profile.id }
        } catch { return null }
      }))
      profiles.push(...batch.filter((profile): profile is NonNullable<typeof profile> => profile !== null))
    }
    if (!profiles.length) return
    await serialize(async () => {
      let next = await accountStore.hydrate()
      for (const profile of profiles) {
        const account = next.accounts.find((item) => item.id === profile.accountId)
        if (!account || account.userId !== profile.userId) continue
        next = await accountStore.updateAccountProfile(profile.accountId, profile)
      }
      const current = stateRef.current.active
      const nextActive = current ? { ...current, account: next.accounts.find((account) => account.id === current.accountId) ?? current.account } : null
      stateRef.current = { ...stateRef.current, active: nextActive, index: next }
      setIndex(next)
      setActive(nextActive)
    })
  }, [serialize])
  const beginSignIn = useCallback((session: AuthSession) => { stagedRef.current = session; setPhase("preparing") }, [])
  const commitSignIn = useCallback(async (session: AuthSession) => { if (!stagedRef.current || session.userId !== stagedRef.current.userId) throw new Error("登录初始化已失效"); const next = await accountStore.hydrate(); const account = next.accounts.find(a => a.serverId === session.id && a.url === session.url && a.userId === session.userId && a.status === "ready"); if (!account) throw new Error("登录凭据尚未安装"); stagedRef.current = null; if (stateRef.current.active?.accountId === account.id) { setPhase("authenticated"); return } await switchAccount(account.id) }, [switchAccount])
  const rollbackSignIn = useCallback(async () => { stagedRef.current = null; setPhase(stateRef.current.active ? "authenticated" : "anonymous") }, [])
  const signOut = useCallback(async () => {
    const id = stateRef.current.active?.accountId
    if (!id) return null
    await signOutAccount(id)
    return stateRef.current.active?.accountId ?? null
  }, [signOutAccount])

  const value = useMemo<AuthContextValue>(() => ({ accounts: index.accounts, active, activeAccount: active?.account ?? null, generation: active?.generation ?? 0, phase, switchAccount, signOutAccount, deactivateActiveAccount, markReauthRequired, refreshMissingAccountProfiles, installAndActivate, beginSignIn, commitSignIn, rollbackSignIn, invalidateSession, signOut, isAuthenticated: Boolean(active), isHydrated: hydrated, isPreparingSignIn: phase === "preparing" || phase === "switching", isSigningOut: phase === "signing-out", session: active?.target ?? null }), [active, beginSignIn, commitSignIn, deactivateActiveAccount, hydrated, index.accounts, installAndActivate, invalidateSession, markReauthRequired, phase, refreshMissingAccountProfiles, rollbackSignIn, signOut, signOutAccount, switchAccount])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用"); return value }
export function useAuthenticatedSession() { const { isAuthenticated, session } = useAuth(); if (!isAuthenticated || !session) throw new Error("当前页面需要已认证的用户会话"); return session }
