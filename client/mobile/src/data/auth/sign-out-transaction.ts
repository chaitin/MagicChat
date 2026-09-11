import type { AccountRecord } from "@/data/auth/account-store"

export function selectRecentReadyAccount(accounts: readonly AccountRecord[], excludedAccountId: string) {
  return [...accounts]
    .filter((account) => account.id !== excludedAccountId && account.status === "ready")
    .sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt))[0]
}

export type SignOutTransactionFailureStage =
  | "candidate-bootstrap"
  | "logout"
  | "cleanup-queue"
  | "remove"
  | "candidate-cas"

/** Purely coordinates failure ownership; account/token data remains in injected boundaries. */
export async function runAccountSignOutTransaction<T>({
  commitCandidate,
  afterLogout,
  isCurrent,
  logout,
  onSafeRollback,
  onSuccess,
  onUnsafeFailure,
  prepareCandidate,
  remove,
  cancelPreparation,
}: {
  commitCandidate: (preparation: T) => Promise<void>
  afterLogout: (remoteInvalidated: boolean) => Promise<void>
  isCurrent: boolean
  logout: () => Promise<boolean>
  onSafeRollback: (error: unknown, stage: SignOutTransactionFailureStage) => Promise<void>
  onSuccess: (preparation: T | undefined) => Promise<void>
  onUnsafeFailure: (error: unknown, stage: SignOutTransactionFailureStage) => Promise<void>
  prepareCandidate: () => Promise<T | undefined>
  remove: () => Promise<void>
  cancelPreparation: (preparation: T | undefined) => void
}) {
  let preparation: T | undefined
  let remoteInvalidated = false
  let removalCommitted = false
  let stage: SignOutTransactionFailureStage = "candidate-bootstrap"
  try {
    preparation = await prepareCandidate()
    stage = "logout"
    remoteInvalidated = await logout()
    stage = "cleanup-queue"
    await afterLogout(remoteInvalidated)
    stage = "remove"
    await remove()
    removalCommitted = true
    if (preparation !== undefined) {
      stage = "candidate-cas"
      await commitCandidate(preparation)
    }
    await onSuccess(preparation)
  } catch (error) {
    cancelPreparation(preparation)
    if (!isCurrent || (!remoteInvalidated && !removalCommitted)) {
      await onSafeRollback(error, stage)
    } else {
      await onUnsafeFailure(error, stage)
    }
    throw error
  }
}
