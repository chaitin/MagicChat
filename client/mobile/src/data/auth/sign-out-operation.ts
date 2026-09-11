export async function runSignOutOperation({
  deactivatePush,
  invalidateSession,
  isCurrentSession,
  logout,
}: {
  deactivatePush: () => Promise<unknown>
  invalidateSession: () => Promise<void>
  isCurrentSession: () => boolean
  logout: () => Promise<void>
}) {
  await logout()
  await deactivatePush().catch(() => undefined)
  if (isCurrentSession()) {
    await invalidateSession()
  }
}
