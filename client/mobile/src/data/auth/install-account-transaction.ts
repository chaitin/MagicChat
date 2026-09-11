export type InstallAccountFailureStage = "install" | "bootstrap" | "commit" | "publish"

export async function runInstallAccountTransaction<T>({
  bootstrap,
  cancelPreparation,
  commit,
  install,
  publish,
  restore,
  onRestoreFailure,
  revokeNewSession,
}: {
  bootstrap: () => Promise<T>
  cancelPreparation: (preparation: T | undefined) => void
  commit: (preparation: T) => Promise<void>
  install: () => Promise<void>
  publish: (preparation: T) => Promise<void>
  restore: (stage: InstallAccountFailureStage) => Promise<void>
  onRestoreFailure: (error: unknown) => Promise<void>
  revokeNewSession: () => Promise<void>
}) {
  let preparation: T | undefined
  let stage: InstallAccountFailureStage = "install"
  try {
    await install()
    stage = "bootstrap"
    preparation = await bootstrap()
    stage = "commit"
    await commit(preparation)
    stage = "publish"
    await publish(preparation)
  } catch (error) {
    cancelPreparation(preparation)
    await revokeNewSession().catch(() => undefined)
    try { await restore(stage) }
    catch (restoreError) { await onRestoreFailure(restoreError) }
    throw error
  }
}
