export type MediaPermissionKind = "camera" | "photos"

type PermissionResponse = {
  canAskAgain: boolean
  granted: boolean
}

export type PermissionAttemptResult = "denied" | "granted" | "settings"

export class MediaPermissionSettingsRequiredError extends Error {
  readonly kind: MediaPermissionKind

  constructor(kind: MediaPermissionKind) {
    super(kind === "camera" ? "需要相机权限" : "需要照片权限")
    this.name = "MediaPermissionSettingsRequiredError"
    this.kind = kind
  }
}

export async function requestPermissionForUserAction(
  getPermission: () => Promise<PermissionResponse>,
  requestPermission: () => Promise<PermissionResponse>
): Promise<PermissionAttemptResult> {
  const current = await getPermission()
  if (current.granted) return "granted"
  if (!current.canAskAgain) return "settings"

  const requested = await requestPermission()
  return requested.granted ? "granted" : "denied"
}
